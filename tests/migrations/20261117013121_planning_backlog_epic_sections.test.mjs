import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves version 64 records and selected contracts while separating Epic and orphan membership", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261117005755");
  await withLocalDatabase(async client => {
    await client.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic strategic migration')");
    await client.query("insert into public.profiles(id,name,platform_role) values('strategic-founder','Synthetic founder','founder')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,status,priority,owner,approval_status) values('strategic-epic','findmydoc-founder-execution','Existing Epic','epic','Offen','P2','strategic-founder','approved')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner,approval_status) values('strategic-initiative','findmydoc-founder-execution','Existing Initiative','initiative','strategic-epic','Offen','P2','strategic-founder','approved')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner,approval_status) values('strategic-deliverable','findmydoc-founder-execution','Existing Deliverable','deliverable','strategic-initiative','Offen','P2','strategic-founder','approved')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,status,priority,owner,approval_status) values('strategic-orphan-initiative','findmydoc-founder-execution','Existing orphan Initiative','initiative','Erledigt','P2','strategic-founder','approved')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,status,priority,owner,approval_status) values('strategic-orphan-deliverable','findmydoc-founder-execution','Existing orphan Deliverable','deliverable','Erledigt','P2','strategic-founder','proposed')");
    const records = async () => ({ projects: (await client.query("select * from public.projects order by id")).rows,
      profiles: (await client.query("select * from public.profiles order by id")).rows, tasks: (await client.query("select * from public.tasks order by id")).rows,
      sprints: (await client.query("select * from public.sprints order by id")).rows, commitments: (await client.query("select * from public.sprint_commitments order by id")).rows });
    const selection = async (level = "deliverable", actor = "strategic-founder") => (await client.query("select public.planning_backlog_selection($1,jsonb_build_object('level',$2::text,'scope','all','sort','rank','direction','asc'),20) value", [actor,level])).rows[0].value;
    const support = async () => (await client.query("select public.planning_backlog_support('strategic-founder','controls','2026-01-01') value")).rows[0].value;
    const before = await records(), old = await selection(), oldSupport = await support();
    await applyMigration(client, resolve("supabase/migrations/20261117013121_planning_backlog_epic_sections.sql"));
    expect(await records()).toEqual(before);
    const current = await selection();
    for (const field of ["status","source_revision","valid_until","total","item_ids","context_ids","rank_by_id"]) expect(current[field]).toEqual(old[field]);
    expect((await support()).controls).toEqual(oldSupport.controls);
    const epic = await selection("epic");expect(epic.status).toBe("ready");expect(epic.item_ids).toEqual(["strategic-epic"]);expect(epic.total).toBe(1);
    for(const [section,id] of [["orphanInitiatives","strategic-orphan-initiative"],["orphanDeliverables","strategic-orphan-deliverable"]]) {
      const orphan=(await client.query("select public.planning_backlog_selection('strategic-founder',jsonb_build_object('level','epic','section',$1::text,'query','No match','status','Offen','priority','P4'),20) value",[section])).rows[0].value;
      expect(orphan.status).toBe("ready");expect(orphan.item_ids).toEqual([id]);expect(orphan.context_ids).toEqual([]);expect(orphan.total).toBe(1);
    }
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
