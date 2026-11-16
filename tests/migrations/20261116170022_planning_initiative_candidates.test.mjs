import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves version 55 Planning records and context while restricting candidate discovery to the admitted service boundary", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261116001423");
  await withLocalDatabase(async client => {
    await client.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic candidate migration')");
    await client.query("insert into public.profiles(id,name,platform_role) values('candidate-migration','Synthetic founder','founder'),('candidate-other','Synthetic other founder','founder')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,status,priority,owner) values('candidate-epic','findmydoc-founder-execution','Existing Epic','epic','Offen','P2','candidate-migration')");
    await client.query("insert into public.tasks(id,project_id,title,task_type,parent_task_id,status,priority,owner,approval_status) values('candidate-initiative','findmydoc-founder-execution','Existing Initiative','initiative','candidate-epic','Offen','P2','candidate-migration','approved')");
    const records = async () => ({
      projects: (await client.query("select * from public.projects order by id")).rows,
      profiles: (await client.query("select * from public.profiles order by id")).rows,
      tasks: (await client.query("select * from public.tasks order by id")).rows,
    });
    const source = async () => (await client.query("select public.planning_detail_source('candidate-initiative','target') value")).rows[0].value;
    const before = await records(), context = await source();
    expect(before.tasks).toHaveLength(2);
    await applyMigration(client, resolve("supabase/migrations/20261116170022_planning_initiative_candidates.sql"));
    expect(await records()).toEqual(before);
    const after = await source();
    for (const field of ["target_id", "ancestor_ids", "source_revision", "valid_until"]) expect(after[field]).toEqual(context[field]);
    const call = async profile => (await client.query("select public.planning_initiative_candidates($1,'Existing',20) value", [profile])).rows[0].value;
    const signature = "public.planning_initiative_candidates(text,text,integer,integer,text,timestamptz,timestamptz)";
    for (const role of ["anon", "authenticated", "service_role"]) {
      expect((await client.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, signature])).rows[0].allowed).toBe(role === "service_role");
      await client.query(`set role ${role}`);
      try {
        if (role !== "service_role") await expect(call("candidate-migration")).rejects.toMatchObject({ code: "42501" });
        else {
          const page = await call("candidate-migration");
          expect(page.status).toBe("ready"); expect(page.total).toBe(1);
          expect(page.items.map(item => item.id)).toEqual(["candidate-initiative"]);
          expect((await call("candidate-other")).status).toBe("ready");
          expect(await call("candidate-unmapped")).toEqual({ status: "forbidden" });
        }
      } finally { await client.query("reset role"); }
    }
  });
});
