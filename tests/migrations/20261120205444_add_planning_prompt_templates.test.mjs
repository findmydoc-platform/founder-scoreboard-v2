import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

const migrationFile = resolve("supabase/migrations/20261120205444_add_planning_prompt_templates.sql");
const users = {
  active: "20000000-0000-0000-0000-000000000021",
  expired: "20000000-0000-0000-0000-000000000022",
  founder: "20000000-0000-0000-0000-000000000023",
  deputy: "20000000-0000-0000-0000-000000000024",
  unmapped: "20000000-0000-0000-0000-000000000025",
};

async function asRole(client, role, user, run) {
  await client.query("select set_config('request.jwt.claim.sub', $1, false)", [user || ""]);
  await client.query(`set role ${role}`);
  try {
    return await run();
  } finally {
    await client.query("reset role");
  }
}

it("allows only active administrators to publish and exposes the committed version to the planning context reader", { timeout: 120_000 }, async () => {
  await resetLocalDatabaseTo("20261119092955");
  await withLocalDatabase(async (client) => {
    await client.query("insert into auth.users (id) select unnest($1::uuid[])", [Object.values(users)]);
    await client.query(`
      insert into public.profiles (id, auth_user_id, name, platform_role)
      values ('prompt-active', $1, 'Active', 'viewer'),
        ('prompt-expired', $2, 'Expired', 'ceo'),
        ('prompt-founder', $3, 'Founder', 'founder'),
        ('prompt-deputy', $4, 'Deputy', 'deputy')
    `, [users.active, users.expired, users.founder, users.deputy]);
    await client.query(`
      insert into public.administrator_access_grants (profile_id, eligible, active_until)
      values ('prompt-active', true, now() + interval '1 hour'),
        ('prompt-expired', true, now() - interval '1 hour')
    `);

    await applyMigration(client, migrationFile);
    const readAdmin = () => client.query("select public.administrator_planning_prompt_templates() as templates");
    const readPublished = () => asRole(client, "service_role", null, async () =>
      (await client.query("select kind, text, version from public.planning_prompt_templates where kind = 'general'")).rows[0]);
    const publish = (text = "Überarbeitete Schreibregeln.", version = 1) =>
      client.query("select public.publish_planning_prompt_template('general', $1, $2) as template", [text, version]);

    const initial = await readPublished();
    expect(initial).toMatchObject({ kind: "general", version: 1 });
    expect(initial.text).toContain("FounderOps");
    for (const user of [users.expired, users.founder, users.deputy, users.unmapped]) {
      await asRole(client, "authenticated", user, async () => {
        await expect(readAdmin()).rejects.toMatchObject({ code: "42501" });
        await expect(publish()).rejects.toMatchObject({ code: "42501" });
      });
    }
    await asRole(client, "anon", null, async () => {
      await expect(readAdmin()).rejects.toMatchObject({ code: "42501" });
      await expect(publish()).rejects.toMatchObject({ code: "42501" });
    });
    expect(await readPublished()).toEqual(initial);

    await asRole(client, "authenticated", users.active, async () => {
      expect((await readAdmin()).rows[0].templates).toContainEqual(initial);
      await expect(client.query("select * from public.planning_prompt_templates")).rejects.toMatchObject({ code: "42501" });
      await expect(client.query("update public.planning_prompt_templates set text = 'bypass'")).rejects.toMatchObject({ code: "42501" });
      await expect(publish("   ")).rejects.toMatchObject({ code: "22023" });
      expect((await publish()).rows[0].template).toEqual({
        kind: "general", text: "Überarbeitete Schreibregeln.", version: 2,
      });
      await expect(publish("Veraltete Bearbeitung.")).rejects.toMatchObject({ code: "P0001" });
    });
    expect(await readPublished()).toEqual({
      kind: "general", text: "Überarbeitete Schreibregeln.", version: 2,
    });
  });
});
