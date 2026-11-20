import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

const migrationFile = resolve("supabase/migrations/20261120210312_add_item_kind_planning_prompt_templates.sql");
const userId = "20000000-0000-0000-0000-000000000026";

it("preserves a published general template and versions each new item template independently", async () => {
  await resetLocalDatabaseTo("20261120205444");
  await withLocalDatabase(async (client) => {
    const general = { kind: "general", text: "Bereits veröffentlichte Schreibregeln.", version: 3 };
    await client.query("update public.planning_prompt_templates set text = $1, version = $2 where kind = 'general'", [general.text, general.version]);
    await client.query("insert into auth.users (id) values ($1)", [userId]);
    await client.query("insert into public.profiles (id, auth_user_id, name, platform_role) values ('prompt-item-admin', $1, 'Admin', 'viewer')", [userId]);
    await client.query("insert into public.administrator_access_grants (profile_id, eligible, active_until) values ('prompt-item-admin', true, now() + interval '1 hour')");

    await applyMigration(client, migrationFile);
    await client.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
    await client.query("set role authenticated");
    try {
      const read = async () => (await client.query("select public.administrator_planning_prompt_templates() as templates")).rows[0].templates;
      const before = await read();
      expect(before).toEqual([
        { kind: "deliverable", text: expect.stringContaining("überprüfbare Ergebnis"), version: 1 },
        general,
        { kind: "initiative", text: expect.stringContaining("Erfolgskriterien"), version: 1 },
        { kind: "sub_issue", text: expect.stringContaining("Arbeitsschritt"), version: 1 },
      ]);
      const publish = async (kind, text) => (await client.query("select public.publish_planning_prompt_template($1, $2, 1) as template", [kind, text])).rows[0].template;
      const updated = { kind: "deliverable", text: "Beschreibe den fertigen Zustand.", version: 2 };
      expect(await publish(updated.kind, updated.text)).toEqual(updated);
      await expect(publish(updated.kind, "Veralteter Entwurf.")).rejects.toMatchObject({ code: "P0001" });
      expect(await read()).toEqual([updated, ...before.slice(1)]);
    } finally {
      await client.query("reset role");
    }
  });
});
