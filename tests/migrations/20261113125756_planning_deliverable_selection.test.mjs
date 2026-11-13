import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves existing Planning data and exposes selected Deliverable SQL only through the server role", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261113050014");
  await withLocalDatabase(async client => {
    await client.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic selection migration')");
    await client.query("insert into public.profiles(id,name,platform_role) values('selection-existing-viewer','Synthetic Viewer','viewer')");
    await client.query("insert into public.tasks(id,project_id,title,status,priority) values('selection-existing-item','findmydoc-founder-execution','Synthetic preserved item','Offen','P2')");
    await client.query("insert into public.profile_ui_preferences(profile_id,planning_filters) values('selection-existing-viewer','{\"query\":\"preserved\"}')");
    const rows = (await client.query("select * from public.tasks where id='selection-existing-item'")).rows;
    const preferences = (await client.query("select * from public.profile_ui_preferences where profile_id='selection-existing-viewer'")).rows;
    const revision = (await client.query("select public.planning_source_version() as value")).rows[0].value;
    await applyMigration(client, resolve("supabase/migrations/20261113125756_planning_deliverable_selection.sql"));
    expect((await client.query("select * from public.tasks where id='selection-existing-item'")).rows).toEqual(rows);
    expect((await client.query("select * from public.profile_ui_preferences where profile_id='selection-existing-viewer'")).rows).toEqual(preferences);
    expect((await client.query("select public.planning_source_version() as value")).rows[0].value).toBe(revision);
    for (const role of ["anon", "authenticated"]) {
      await client.query(`set role ${role}`);
      try {
        await expect(client.query("select public.planning_deliverable_selection('selection-existing-viewer','{}')")).rejects.toMatchObject({ code: "42501" });
        await expect(client.query("select public.planning_selection_status('done',true)")).rejects.toMatchObject({ code: "42501" });
      } finally { await client.query("reset role"); }
    }
    await client.query("set role service_role");
    try {
      expect((await client.query("select public.planning_deliverable_selection('selection-existing-viewer','{}') as value")).rows[0].value.status).toBe("ready");
      expect((await client.query("select public.planning_selection_status('done',true) as value")).rows[0].value).toBe("Erledigt");
      expect((await client.query("select public.planning_deliverable_selection('missing-profile','{}') as value")).rows[0].value.status).toBe("forbidden");
    } finally { await client.query("reset role"); }
  });
});
