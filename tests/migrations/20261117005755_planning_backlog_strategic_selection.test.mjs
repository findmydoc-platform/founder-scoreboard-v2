import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves version 63 records and Deliverable selection while adding service-only strategic membership", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261117000845");
  await withLocalDatabase(async client => {
    await client.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic strategic migration')");
    await client.query("insert into public.profiles(id,name,platform_role) values('strategic-founder','Synthetic founder','founder')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,status,priority,owner,approval_status) values('strategic-epic','findmydoc-founder-execution','Existing Epic','epic','Offen','P2','strategic-founder','approved')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner,approval_status) values('strategic-initiative','findmydoc-founder-execution','Existing Initiative','initiative','strategic-epic','Offen','P2','strategic-founder','approved')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner,approval_status) values('strategic-deliverable','findmydoc-founder-execution','Existing Deliverable','deliverable','strategic-initiative','Offen','P2','strategic-founder','approved')");
    const records = async () => ({ projects: (await client.query("select * from public.projects order by id")).rows,
      profiles: (await client.query("select * from public.profiles order by id")).rows, tasks: (await client.query("select * from public.tasks order by id")).rows,
      sprints: (await client.query("select * from public.sprints order by id")).rows, commitments: (await client.query("select * from public.sprint_commitments order by id")).rows });
    const selection = async (level = "deliverable", actor = "strategic-founder") => (await client.query("select public.planning_backlog_selection($1,jsonb_build_object('level',$2::text,'scope','all','sort','rank','direction','asc'),20) value", [actor,level])).rows[0].value;
    const support = async () => (await client.query("select public.planning_backlog_support('strategic-founder','controls','2026-01-01') value")).rows[0].value;
    const before = await records(), old = await selection(), oldSupport = await support();
    await applyMigration(client, resolve("supabase/migrations/20261117005755_planning_backlog_strategic_selection.sql"));
    expect(await records()).toEqual(before);
    const current = await selection();
    for (const field of ["status","source_revision","valid_until","total","item_ids","context_ids","rank_by_id"]) expect(current[field]).toEqual(old[field]);
    expect((await support()).controls).toEqual(oldSupport.controls);
    const strategic = await selection("initiative");expect(strategic.status).toBe("ready");expect(strategic.item_ids).toEqual(["strategic-initiative"]);expect(strategic.context_ids).toEqual(["strategic-epic"]);
    const signature = "public.planning_backlog_selection(text,jsonb,integer,integer,text,timestamptz,timestamptz)";
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect((await client.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, signature])).rows[0].allowed).toBe(role === "service_role");
      await client.query(`set role ${role}`);
      try {
        if (role !== "service_role") await expect(selection("initiative")).rejects.toMatchObject({ code: "42501" });
        else expect(await selection("initiative","strategic-unmapped")).toEqual({ status: "forbidden" });
      } finally { await client.query("reset role"); }
    }
  });
});
