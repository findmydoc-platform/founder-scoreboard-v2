import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves version 61 records and support while adding service-only relative rank resolution", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261116225650");
  await withLocalDatabase(async client => {
    await client.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic rank migration')");
    await client.query("insert into public.profiles(id,name,platform_role) values('rank-founder','Synthetic founder','founder')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,status,priority,owner,approval_status) values('rank-epic','findmydoc-founder-execution','Existing Epic','epic','Offen','P2','rank-founder','approved')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner,approval_status) values('rank-initiative','findmydoc-founder-execution','Existing Initiative','initiative','rank-epic','Offen','P2','rank-founder','approved')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner,approval_status) values('rank-deliverable','findmydoc-founder-execution','Existing Deliverable','deliverable','rank-initiative','Offen','P2','rank-founder','approved')");
    const records = async () => ({ projects: (await client.query("select * from public.projects order by id")).rows,
      profiles: (await client.query("select * from public.profiles order by id")).rows, tasks: (await client.query("select * from public.tasks order by id")).rows,
      sprints: (await client.query("select * from public.sprints order by id")).rows, commitments: (await client.query("select * from public.sprint_commitments order by id")).rows });
    const support = async () => (await client.query("select public.planning_backlog_support('rank-founder','controls','2026-01-01') value")).rows[0].value;
    const before = await records(), oldSupport = await support();
    const source = (await client.query("select updated_at::text as version,public.planning_source_version() as revision from public.tasks where id='rank-deliverable'")).rows[0];
    await applyMigration(client, resolve("supabase/migrations/20261116230848_planning_backlog_rank_target.sql"));
    expect(await records()).toEqual(before);
    const currentSupport = await support();
    for (const field of ["status", "source_revision", "valid_until", "controls"]) expect(currentSupport[field]).toEqual(oldSupport[field]);
    const signature = "public.planning_backlog_rank_target(text,text,timestamptz,text,text)";
    const read = async actor => (await client.query("select public.planning_backlog_rank_target($1,'rank-deliverable',$2,$3,'top') value", [actor, source.version, source.revision])).rows[0].value;
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect((await client.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, signature])).rows[0].allowed).toBe(role === "service_role");
      await client.query(`set role ${role}`);
      try {
        if (role !== "service_role") await expect(read("rank-founder")).rejects.toMatchObject({ code: "42501" });
        else {
          expect(await read("rank-founder")).toMatchObject({ status: "ready", target_id: null, noop: true, source_revision: source.revision });
          expect(await read("rank-unmapped")).toEqual({ status: "forbidden" });
        }
      } finally { await client.query("reset role"); }
    }
  });
});
