import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves existing records and restricts Sprint snapshots to an active matching server-supplied session", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261120102829");
  await withLocalDatabase(async db => {
    const user = randomUUID(), session = randomUUID(), other = randomUUID();
    await db.query("insert into auth.users(id,email,role,aud) values($1,'sprint-upgrade@example.test','authenticated','authenticated'),($2,'sprint-other@example.test','authenticated','authenticated')", [user, other]);
    await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [session, user]);
    await db.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Sprint upgrade')");
    await db.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('upgrade-viewer',$1,'Sprint viewer','viewer')", [user]);
    await db.query("insert into public.sprints(id,project_id,name,start_date,end_date) values('upgrade-sprint','findmydoc-founder-execution','Sprint upgrade','2000-01-01','2099-12-31')");
    const stored = (await db.query("select * from public.sprints")).rows;
    const source = (await db.query("select public.planning_source_version() as value")).rows[0].value;
    await applyMigration(db, resolve("supabase/migrations/20261120222556_planning_sprint_task_scopes.sql"));
    expect((await db.query("select * from public.sprints")).rows).toEqual(stored);
    expect((await db.query("select public.planning_source_version() as value")).rows[0].value).toBe(source);
    const signature = "public.planning_sprint_task_scope(text,uuid,uuid,text,timestamptz,text,text,jsonb,integer,text,timestamptz)";
    const call = async (actor = user, role = "viewer", deadline = "now() + interval '1 hour'") => (await db.query(`select public.planning_sprint_task_scope('upgrade-viewer',$1,$2,$3,${deadline},'selected',null,'{}') value`, [actor, session, role])).rows[0].value;
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, signature])).rows[0].allowed).toBe(role === "service_role");
      await db.query(`set role ${role}`);
      try {
        if (role !== "service_role") await expect(call()).rejects.toMatchObject({ code: "42501" });
        else {
          const page = await call();
          expect(page).toMatchObject({ status: "ready", sprint_id: "upgrade-sprint", scope_total: 0, member_ids: [], source_revision: source });
          expect(Date.parse(page.valid_until)).toBeGreaterThan(Date.parse(page.evaluated_at));
          expect(await call(other)).toEqual({ status: "forbidden" });
          expect(await call(user, "ceo")).toEqual({ status: "forbidden" });
          expect(await call(user, "viewer", "now() - interval '1 hour'")).toEqual({ status: "forbidden" });
        }
      } finally { await db.query("reset role"); }
    }
    await db.query("delete from auth.sessions where id=$1", [session]);
    expect(await call()).toEqual({ status: "forbidden" });
  });
});
