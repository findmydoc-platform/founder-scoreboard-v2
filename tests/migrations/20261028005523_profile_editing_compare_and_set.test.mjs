import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

const migration = resolve("supabase/migrations/20261028005523_profile_editing_compare_and_set.sql");
const users = { ceo: "73000000-0000-4000-8000-000000000001", founder: "73000000-0000-4000-8000-000000000002", deputy: "73000000-0000-4000-8000-000000000003", viewer: "73000000-0000-4000-8000-000000000004", unmapped: "73000000-0000-4000-8000-000000000005" };

async function asRole(client, role, user, run) {
  await client.query("begin");
  try {
    await client.query("select set_config('request.jwt.claims',$1,true), set_config('request.jwt.claim.sub',$2,true), set_config('request.jwt.claim.role',$3,true)", [JSON.stringify({ role, ...(user ? { sub: user } : {}) }), user || "", role]);
    await client.query(`set local role ${role}`);
    const result = await run();
    await client.query("commit");
    return result;
  } catch (error) { await client.query("rollback"); throw error; }
}
const settings = (client, patch, ui = null, events = {}) => asRole(client, "service_role", null, () => client.query("select public.update_profile_settings_transaction('cas-founder',$1::jsonb,$2::jsonb,$3::jsonb,null,null) as result", [JSON.stringify(patch), ui === null ? null : JSON.stringify(ui), JSON.stringify(events)]));
async function rows(client) {
  const result = {};
  for (const table of ["profiles", "profile_ui_preferences", "notification_preferences", "audit_log"]) result[table] = (await client.query(`select to_jsonb(row) as data from public.${table} row order by to_jsonb(row)::text`)).rows;
  return result;
}

it("preserves existing profile records and rejects a stale edit before transaction effects", { timeout: 120000 }, async () => {
  await resetLocalDatabaseTo("20261023142614");
  await withLocalDatabase(async client => {
    await client.query("insert into auth.users(id) select unnest($1::uuid[])", [Object.values(users)]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role,focus,weekly_capacity) values ('cas-ceo',$1,'CEO','ceo','CEO focus',40),('cas-founder',$2,'Founder','founder','Original focus',30),('cas-deputy',$3,'Deputy','deputy',null,20),('cas-viewer',$4,'Viewer','viewer',null,10)", [users.ceo, users.founder, users.deputy, users.viewer]);
    const before = await rows(client);
    await applyMigration(client, migration);
    expect(await rows(client)).toEqual(before);
    await expect(settings(client, { focus: "Stale replacement", _expected: { profile: { focus: "Old focus" }, events: {} } })).rejects.toMatchObject({ code: "P0004" });
    expect(await rows(client)).toEqual(before);

    const saved = await settings(client, { focus: "Saved focus", _expected: { profile: { focus: "Original focus" }, events: {} } });
    expect(saved.rows[0].result.profile.focus).toBe("Saved focus");
    const governance = (patch, user = users.ceo) => asRole(client, "authenticated", user, () => client.query("select public.update_profile_governance_transaction('cas-founder',$1::jsonb,null,null) as result", [JSON.stringify(patch)]));
    expect((await governance({ weekly_capacity: 31, _expected: { weekly_capacity: 30 } })).rows[0].result.profile.weekly_capacity).toBe(31);
    let confirmed = await rows(client);
    await expect(governance({ weekly_capacity: 32, _expected: { weekly_capacity: 30 } })).rejects.toMatchObject({ code: "P0004" });
    expect(await rows(client)).toEqual(confirmed);
    for (const user of [users.founder, users.deputy, users.viewer, users.unmapped]) {
      await expect(governance({ weekly_capacity: 32, _expected: { weekly_capacity: 31 } }, user)).rejects.toMatchObject({ code: "42501" });
    }
    for (const user of Object.values(users)) {
      await expect(asRole(client, "authenticated", user, () => client.query("select public.update_profile_settings_transaction('cas-founder','{}'::jsonb,null,'{}'::jsonb,null,null)"))).rejects.toMatchObject({ code: "42501" });
    }
    await expect(asRole(client, "anon", null, () => client.query("select public.update_profile_governance_transaction('cas-founder','{}'::jsonb,null,null)"))).rejects.toMatchObject({ code: "42501" });
    await expect(asRole(client, "anon", null, () => client.query("select public.update_profile_settings_transaction('cas-founder','{}'::jsonb,null,'{}'::jsonb,null,null)"))).rejects.toMatchObject({ code: "42501" });
    await expect(governance({ weekly_capacity: 32, _expected: { auth_user_id: users.ceo } })).rejects.toMatchObject({ code: "22023" });
    expect(await rows(client)).toEqual(confirmed);

    const initialUi = { default_workspace: "planning", default_task_view: "board", planning_filters: {}, expanded_item_ids: [] };
    const initialEvents = { "task.blocker_reported": false };
    const preferences = await settings(client, { _expected: { profile: {}, ui: null, events: { "task.blocker_reported": null } } }, initialUi, initialEvents);
    expect(preferences.rows[0].result.ui_preference.default_task_view).toBe("board");
    expect(preferences.rows[0].result.notification_preferences[0].enabled).toBe(false);
    confirmed = await rows(client);
    await expect(settings(client, { focus: "Must roll back", _expected: { profile: { focus: "Saved focus" }, ui: null } }, initialUi)).rejects.toMatchObject({ code: "P0004" });
    expect(await rows(client)).toEqual(confirmed);
    await expect(settings(client, { focus: "Must also roll back", _expected: { profile: { focus: "Saved focus" }, events: { "task.blocker_reported": null } } }, null, initialEvents)).rejects.toMatchObject({ code: "P0004" });
    expect(await rows(client)).toEqual(confirmed);
    const nextUi = { ...initialUi, default_task_view: "table" };
    const next = await settings(client, { focus: null, _expected: { profile: { focus: "Saved focus" }, ui: initialUi, events: { "task.blocker_reported": false } } }, nextUi, { "task.blocker_reported": true });
    expect(next.rows[0].result.profile.focus).toBeNull();
    expect(next.rows[0].result.ui_preference.default_task_view).toBe("table");
    expect(next.rows[0].result.notification_preferences[0].enabled).toBe(true);
    confirmed = await rows(client);
    await expect(settings(client, { focus: "Old event overwrite", _expected: { profile: { focus: null }, events: { "task.blocker_reported": false } } }, null, initialEvents)).rejects.toMatchObject({ code: "P0004" });
    expect(await rows(client)).toEqual(confirmed);

    const concurrent = await Promise.allSettled(["First draft", "Second draft"].map(focus => withLocalDatabase(other => settings(other, { focus, _expected: { profile: { focus: null } } }))));
    expect(concurrent.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(concurrent.filter(result => result.status === "rejected").map(result => result.reason.code)).toEqual(["P0004"]);
    expect(["First draft", "Second draft"]).toContain((await client.query("select focus from public.profiles where id='cas-founder'")).rows[0].focus);
    expect((await governance({ weekly_capacity: 32 })).rows[0].result.profile.weekly_capacity).toBe(32);
    const preserved = await rows(client);
    await applyMigration(client, migration);
    expect(await rows(client)).toEqual(preserved);
    await governance({ platform_role: "ceo", _expected: { platform_role: "founder" } });
    expect((await client.query("select id from public.profiles where platform_role='ceo'")).rows).toEqual([{ id: "cas-founder" }]);
    await expect(governance({ weekly_capacity: 33 })).rejects.toMatchObject({ code: "42501" });
    await expect(governance({ platform_role: "founder", _expected: { platform_role: "ceo" } }, users.founder)).rejects.toMatchObject({ code: "23514" });
    expect((await client.query("select id from public.profiles where platform_role='ceo'")).rows).toEqual([{ id: "cas-founder" }]);
  });
});
