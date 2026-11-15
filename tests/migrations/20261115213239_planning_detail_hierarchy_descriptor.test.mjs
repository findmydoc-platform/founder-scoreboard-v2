import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves detail data and scalar source while exposing the bounded hierarchy only to the server", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261115190023");
  await withLocalDatabase(async client => {
    await client.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic descriptor migration')");
    await client.query("insert into public.profiles(id,name,platform_role) values('descriptor-migration','Synthetic founder','founder')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,status,owner) values('descriptor-epic','findmydoc-founder-execution','Existing Epic','epic','Offen','descriptor-migration')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,status,owner,parent_task_id) values('descriptor-initiative','findmydoc-founder-execution','Existing Initiative','initiative','Offen','descriptor-migration','descriptor-epic')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,status,owner,parent_task_id) values('descriptor-target','findmydoc-founder-execution','Existing target','deliverable','Offen','descriptor-migration','descriptor-initiative')");
    await client.query("insert into public.task_comments(task_id,profile_id,comment) values('descriptor-target','descriptor-migration','Existing discussion')");
    const rows = async () => ({ tasks: (await client.query("select * from public.tasks order by id")).rows, profiles: (await client.query("select * from public.profiles order by id")).rows, comments: (await client.query("select * from public.task_comments order by id")).rows });
    const before = await rows();
    const source = async () => (await client.query("select public.planning_detail_source('descriptor-target','target') as value")).rows[0].value;
    const old = await source();
    await applyMigration(client, resolve("supabase/migrations/20261115213239_planning_detail_hierarchy_descriptor.sql"));
    expect(await rows()).toEqual(before);
    const current = await source();
    expect(current).toMatchObject({ target_id: "descriptor-target", ancestor_ids: ["descriptor-epic", "descriptor-initiative"], source_revision: old.source_revision });
    expect(Date.parse(current.observed_at)).toBeLessThan(Date.parse(current.valid_until));
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect((await client.query("select has_function_privilege($1,'public.planning_detail_source(text,text)','EXECUTE') as allowed", [role])).rows[0].allowed).toBe(role === "service_role");
      expect((await client.query("select has_function_privilege($1,'public.planning_detail_publication_context(text,text)','EXECUTE') as allowed", [role])).rows[0].allowed).toBe(role === "authenticated");
      await client.query(`set role ${role}`);
      try {
        if (role === "service_role") expect(await source()).toMatchObject({ target_id: "descriptor-target", ancestor_ids: ["descriptor-epic", "descriptor-initiative"] });
        else await expect(source()).rejects.toMatchObject({ code: "42501" });
      } finally { await client.query("reset role"); }
    }
  });
});
