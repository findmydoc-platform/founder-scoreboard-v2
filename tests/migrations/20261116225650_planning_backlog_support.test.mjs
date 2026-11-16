import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves version 60 selection and records while adding service-only support and transactional commitment invalidation", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261116222312");
  await withLocalDatabase(async client => {
    await client.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic support migration')");
    await client.query("insert into public.profiles(id,name,platform_role) values('support-founder','Synthetic founder','founder')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,status,priority,owner,approval_status) values('support-epic','findmydoc-founder-execution','Existing Epic','epic','Offen','P2','support-founder','approved')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner,approval_status) values('support-initiative','findmydoc-founder-execution','Existing Initiative','initiative','support-epic','Offen','P2','support-founder','approved')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner,approval_status) values('support-deliverable','findmydoc-founder-execution','Existing Deliverable','deliverable','support-initiative','Offen','P2','support-founder','approved')");
    await client.query("insert into public.sprints(id,project_id,name,status,start_date,end_date) values('support-sprint','findmydoc-founder-execution','Existing Sprint','active','2026-01-01','2026-01-07')");
    await client.query("insert into public.sprint_commitments(sprint_id,profile_id,commitment_level,weekly_hours,note) values('support-sprint','support-founder','Standard',13,'Existing note')");
    const records = async () => ({ projects: (await client.query("select * from public.projects order by id")).rows,
      profiles: (await client.query("select * from public.profiles order by id")).rows, tasks: (await client.query("select * from public.tasks order by id")).rows,
      sprints: (await client.query("select * from public.sprints order by id")).rows, commitments: (await client.query("select * from public.sprint_commitments order by id")).rows });
    const source = async () => (await client.query("select public.planning_source_version() as version")).rows[0].version;
    const selection = async () => (await client.query("select public.planning_backlog_selection('support-founder',$1::jsonb,20) value", [JSON.stringify({ level: "deliverable", query: "", scope: "all", sort: "rank", direction: "asc" })])).rows[0].value;
    const oldRecords = await records(), oldSource = await source(), oldSelection = await selection();
    const grants = async () => (await client.query("select role,has_table_privilege(role,'public.sprint_commitments','INSERT') as insert,has_table_privilege(role,'public.sprint_commitments','UPDATE') as update from unnest(array['anon','authenticated','service_role']) role")).rows;
    const oldGrants = await grants();
    await applyMigration(client, resolve("supabase/migrations/20261116225650_planning_backlog_support.sql"));
    expect(await records()).toEqual(oldRecords); expect(await source()).toBe(oldSource); expect(await grants()).toEqual(oldGrants);
    const next = await selection();
    for (const key of ["status", "source_revision", "valid_until", "item_ids", "context_ids", "rank_by_id", "total"]) expect(next[key]).toEqual(oldSelection[key]);
    const signature = "public.planning_backlog_support(text,text,date,timestamptz,timestamptz)";
    const read = async actor => (await client.query("select public.planning_backlog_support($1,'sprints','2026-01-02') value", [actor])).rows[0].value;
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect((await client.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, signature])).rows[0].allowed).toBe(role === "service_role");
      await client.query(`set role ${role}`);
      try {
        if (role !== "service_role") await expect(read("support-founder")).rejects.toMatchObject({ code: "42501" });
        else {
          const value = await read("support-founder"); expect(value.status).toBe("ready"); expect(value.buckets[0].capacityHours).toBe(13);
          expect(await read("support-unmapped")).toEqual({ status: "forbidden" });
        }
      } finally { await client.query("reset role"); }
    }
    await client.query("begin");
    try {
      await client.query("update public.sprint_commitments set weekly_hours=17 where sprint_id='support-sprint'");
      expect(await source()).not.toBe(oldSource);
    } finally { await client.query("rollback"); }
    expect(await source()).toBe(oldSource); expect(await records()).toEqual(oldRecords);
  });
});
