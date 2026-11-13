import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves Planning rows and exposes its source-only clock exclusively to the server", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261107012620");
  await withLocalDatabase(async client => {
    await client.query("insert into public.projects(id,name) values('findmydoc-founder-execution','Synthetic Planning')");
    await client.query("insert into public.profiles(id,name,platform_role) values('version-existing-profile','Synthetic Person','viewer')");
    await client.query("insert into public.profile_ui_preferences(profile_id,expanded_item_ids) values('version-existing-profile',array['preserved-identity'])");
    await client.query("insert into public.tasks(id,project_id,title,status,priority) values('version-existing-item','findmydoc-founder-execution','Synthetic Item','Offen','P2')");
    const items = (await client.query("select * from public.tasks where id='version-existing-item'")).rows;
    const preferences = (await client.query("select * from public.profile_ui_preferences where profile_id='version-existing-profile'")).rows;
    await applyMigration(client, resolve("supabase/migrations/20261113050014_planning_source_version_observation.sql"));
    expect((await client.query("select * from public.tasks where id='version-existing-item'")).rows).toEqual(items);
    expect((await client.query("select * from public.profile_ui_preferences where profile_id='version-existing-profile'")).rows).toEqual(preferences);
    const version = async () => (await client.query("select public.planning_source_version() as value")).rows[0].value;
    const before = await version();
    await client.query("update public.profile_ui_preferences set expanded_item_ids=array['other-identity'] where profile_id='version-existing-profile'");
    expect(await version()).not.toBe(before);
    for (const role of ["anon", "authenticated"]) {
      await client.query(`set role ${role}`);
      try { await expect(version()).rejects.toMatchObject({ code: "42501" }); }
      finally { await client.query("reset role"); }
    }
    await client.query("set role service_role");
    try { expect(await version()).toEqual(expect.any(String)); }
    finally { await client.query("reset role"); }
  });
});
