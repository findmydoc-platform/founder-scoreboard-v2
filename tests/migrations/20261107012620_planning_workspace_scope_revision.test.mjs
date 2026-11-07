import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves existing Planning data and gives only the server a transactional source revision", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261104155306");
  await withLocalDatabase(async client => {
    await client.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic Planning')");
    await client.query("insert into public.tasks(id,project_id,title,status,priority) values('revision-existing','findmydoc-founder-execution','Existing Item','Offen','P2')");
    const existing = (await client.query("select * from public.tasks where id='revision-existing'")).rows;
    await applyMigration(client, resolve("supabase/migrations/20261107012620_planning_workspace_scope_revision.sql"));
    expect((await client.query("select * from public.tasks where id='revision-existing'")).rows).toEqual(existing);
    const snapshot = async () => (await client.query("select public.planning_workspace_snapshot() as value")).rows[0].value;
    const before = await snapshot();
    expect(before).toMatchObject({ id: "findmydoc-founder-execution", active_task_count: 1 });
    expect(before.scope_revision).toEqual(expect.any(String));
    await client.query("begin");
    await client.query("update public.tasks set title='Rolled back' where id='revision-existing'");
    expect((await snapshot()).scope_revision).not.toBe(before.scope_revision);
    await client.query("rollback");
    expect((await snapshot()).scope_revision).toBe(before.scope_revision);
    await client.query("select set_config('founderops.trash_lifecycle_write','on',false)");
    await client.query("delete from public.tasks where id='revision-existing'");
    expect(await snapshot()).toMatchObject({ active_task_count: 0 });
    expect((await snapshot()).scope_revision).not.toBe(before.scope_revision);
    for (const role of ["anon", "authenticated"]) {
      expect((await client.query("select has_function_privilege($1,'public.planning_workspace_snapshot()','execute') as allowed", [role])).rows[0].allowed).toBe(false);
      await client.query(`set role ${role}`);
      try { await expect(client.query("select public.planning_workspace_snapshot()")).rejects.toMatchObject({ code: "42501" }); }
      finally { await client.query("reset role"); }
    }
    await client.query("set role service_role");
    try { expect((await snapshot()).scope_revision).toEqual(expect.any(String)); }
    finally { await client.query("reset role"); }
  });
});
