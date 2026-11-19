import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves schema 73 records and authorization while adding service-only complete Team metrics", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261118091800");
  await withLocalDatabase(async db => {
    const user = randomUUID(), otherUser = randomUUID();
    await db.query("insert into auth.users(id,email,role,aud) values($1,'team-metric-upgrade@example.test','authenticated','authenticated'),($2,'team-other-upgrade@example.test','authenticated','authenticated')", [user, otherUser]);
    await db.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Team metric upgrade')");
    await db.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('metric-founder',$1,'Shared display name','founder'),('metric-other',$2,'Shared display name','founder')", [user, otherUser]);
    await db.query("insert into public.tasks(id,project_id,title,task_type,status,owner) values('metric-epic','findmydoc-founder-execution','Metric Epic','epic','Offen','metric-other')");
    await db.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,approval_status,owner) values('metric-parent','findmydoc-founder-execution','Metric Parent','initiative','metric-epic','Offen','P2','approved','metric-other')");
    await db.query(`insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,approval_status,owner,assignee,estimate_hours)
      values('metric-open','findmydoc-founder-execution','Open metric','deliverable','metric-parent','Offen','P0','approved','metric-founder',null,2),
        ('metric-done','findmydoc-founder-execution','Done metric','deliverable','metric-parent','Erledigt','P1','approved','metric-founder','metric-founder',5),
        ('metric-foreign','findmydoc-founder-execution','Foreign metric','deliverable','metric-parent','Offen','P1','approved','metric-founder','metric-other',13)`);
    const at = (await db.query("select statement_timestamp()::text value")).rows[0].value;
    const records = async () => ({
      projects: (await db.query("select * from public.projects order by id")).rows,
      profiles: (await db.query("select * from public.profiles order by id")).rows,
      tasks: (await db.query("select * from public.tasks order by id")).rows,
      users: (await db.query("select * from auth.users order by id")).rows,
      source: (await db.query("select public.planning_source_version() value")).rows[0].value,
    });
    const authorization = async () => ({
      functions: (await db.query(`select oid::regprocedure::text signature,pg_get_userbyid(proowner) owner,prosecdef,provolatile,proconfig,proacl::text acl
        from pg_proc where oid=any($1::regprocedure[]) order by oid::regprocedure::text`, [[
          "public.planning_source_version()", "public.planning_gantt_selection(text,uuid,jsonb,timestamptz)",
          "public.planning_backlog_selection(text,jsonb,integer,integer,text,timestamptz,timestamptz)",
        ]])).rows,
      policies: (await db.query("select * from pg_policies where schemaname in ('public','workspace_private') order by schemaname,tablename,policyname")).rows,
      tables: (await db.query("select oid::regclass::text name,relrowsecurity,relforcerowsecurity,relacl::text acl from pg_class where relnamespace='public'::regnamespace and relkind in ('r','v') order by oid::regclass::text")).rows,
    });
    const oldGantt = async () => (await db.query("select public.planning_gantt_selection('metric-founder',$1::uuid,'{}'::jsonb,$2::timestamptz) value", [user, at])).rows[0].value;
    const before = await records(), privileges = await authorization(), previous = await oldGantt();
    expect(previous.status).toBe("ready");
    await applyMigration(db, resolve("supabase/migrations/20261118114446_planning_team_metrics.sql"));
    expect(await records()).toEqual(before);
    expect(await authorization()).toEqual(privileges);
    expect(await oldGantt()).toEqual(previous);
    const signature = "public.planning_team_metrics(text,uuid,timestamptz)";
    const definition = (await db.query("select pg_get_userbyid(proowner) owner,prosecdef,provolatile,proconfig from pg_proc where oid=$1::regprocedure", [signature])).rows[0];
    expect(definition).toEqual({ owner: privileges.functions.find(value => value.signature.includes("planning_gantt_selection(")).owner, prosecdef: false, provolatile: "s", proconfig: ['search_path=""'] });
    expect((await db.query("select count(*)::int count from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl where p.oid=$1::regprocedure and acl.grantee=0 and acl.privilege_type='EXECUTE'", [signature])).rows[0].count).toBe(0);
    const metrics = async (profile = "metric-founder", actor = user) => (await db.query("select public.planning_team_metrics($1,$2::uuid,$3::timestamptz) value", [profile, actor, at])).rows[0].value;
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, signature])).rows[0].allowed).toBe(role === "service_role");
      await db.query(`set role ${role}`);
      try {
        if (role !== "service_role") await expect(metrics()).rejects.toMatchObject({ code: "42501" });
        else {
          const result = await metrics(); expect(result.status).toBe("ready");
          expect(result.metrics_by_profile_id).toEqual({ "metric-founder": { openTasks: 1, highPriorityTasks: 1, loadHours: 7 }, "metric-other": { openTasks: 3, highPriorityTasks: 1, loadHours: 13 } });
          expect(result.source_revision).toBe(before.source); expect(Date.parse(result.evaluated_at)).toBe(Date.parse(at));
          expect(result.valid_until).toBeNull(); expect(result.coverage).toBe("complete");
          expect(await metrics("unmapped-metric")).toEqual({ status: "forbidden" });
          expect(await metrics("metric-founder", otherUser)).toEqual({ status: "forbidden" });
          expect(await metrics("metric-founder", null)).toEqual({ status: "forbidden" });
        }
      } finally { await db.query("reset role"); }
    }
    const original = await metrics();
    await db.query("begin");
    try {
      await db.query("update public.tasks set estimate_hours=3 where id='metric-open'");
      const changed = await metrics(); expect(changed.source_revision).not.toBe(original.source_revision);
      expect(changed.metrics_by_profile_id['metric-founder'].loadHours).toBe(8);
    } finally { await db.query("rollback"); }
    expect(await metrics()).toEqual(original);
  });
});
