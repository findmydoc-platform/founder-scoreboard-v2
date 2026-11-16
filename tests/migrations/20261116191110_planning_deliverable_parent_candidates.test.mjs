import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves version 57 records and existing parent intents while adding service-only Deliverable context", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261116182817");
  await withLocalDatabase(async client => {
    await client.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic parent candidate migration')");
    await client.query("insert into public.profiles(id,name,platform_role) values('parent-candidate-migration','Synthetic founder','founder')");
    await client.query(`insert into public.tasks(id,project_id,title,task_type,status,priority,sort_order,owner,approval_status)
      values('parent-default-first','findmydoc-founder-execution','Existing first Epic','epic','Offen','P2',0,'parent-candidate-migration','approved'),
      ('parent-default-active','findmydoc-founder-execution','Existing active Epic','epic','In Arbeit','P2',1000,'parent-candidate-migration','approved')`);
    await client.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner,approval_status) values('parent-migration-initiative','findmydoc-founder-execution','Existing Initiative','initiative','parent-default-first','Offen','P2','parent-candidate-migration','approved')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner,approval_status) values('parent-migration-deliverable','findmydoc-founder-execution','Existing unapproved Deliverable','deliverable','parent-migration-initiative','Offen','P2','parent-candidate-migration','proposed')");
    const records = async () => ({ projects: (await client.query("select * from public.projects order by id")).rows,
      profiles: (await client.query("select * from public.profiles order by id")).rows,
      tasks: (await client.query("select * from public.tasks order by id")).rows });
    const legacy = async () => (await client.query("select public.planning_initiative_candidates('parent-candidate-migration','Existing',20) value")).rows[0].value;
    const context = async () => (await client.query("select public.planning_detail_source('parent-migration-initiative','target') value")).rows[0].value;
    const epic = async () => (await client.query("select public.planning_item_candidates('parent-candidate-migration','epic','',1) value")).rows[0].value;
    const before = await records(), oldLegacy = await legacy(), oldContext = await context(), oldEpic = await epic();
    expect(before.tasks).toHaveLength(4); expect(oldLegacy.status).toBe("ready");
    await applyMigration(client, resolve("supabase/migrations/20261116191110_planning_deliverable_parent_candidates.sql"));
    expect(await records()).toEqual(before);
    const nextLegacy = await legacy(), nextContext = await context();
    for (const field of ["items", "total", "source_revision", "valid_until"]) expect(nextLegacy[field]).toEqual(oldLegacy[field]);
    expect(nextLegacy).not.toHaveProperty("default_candidate");
    for (const field of ["target_id", "ancestor_ids", "source_revision", "valid_until"]) expect(nextContext[field]).toEqual(oldContext[field]);
    const nextEpic = await epic();
    for (const field of ["items", "total", "source_revision", "valid_until", "default_candidate"]) expect(nextEpic[field]).toEqual(oldEpic[field]);
    const signature = "public.planning_item_candidates(text,text,text,integer,integer,text,timestamptz,timestamptz)";
    const oldSignature = "public.planning_initiative_candidates(text,text,integer,integer,text,timestamptz,timestamptz)";
    const read = async actor => (await client.query("select public.planning_item_candidates($1,'deliverable','',1) value", [actor])).rows[0].value;
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const fn of [signature, oldSignature]) expect((await client.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, fn])).rows[0].allowed).toBe(role === "service_role");
      await client.query(`set role ${role}`);
      try {
        if (role !== "service_role") {
          await expect(read("parent-candidate-migration")).rejects.toMatchObject({ code: "42501" });
          await expect(legacy()).rejects.toMatchObject({ code: "42501" });
        } else {
          const page = await read("parent-candidate-migration");
          expect(page.status).toBe("ready"); expect(page.total).toBe(1);
          expect(page.items).toEqual([expect.objectContaining({ id: "parent-migration-deliverable", parentTaskId: "parent-migration-initiative", parentTitle: "Existing Initiative", approvalStatus: "proposed" })]);
          expect(page).not.toHaveProperty("default_candidate");
          expect((await legacy()).items).toEqual(oldLegacy.items);
          expect(await read("parent-candidate-unmapped")).toEqual({ status: "forbidden" });
        }
      } finally { await client.query("reset role"); }
    }
  });
});
