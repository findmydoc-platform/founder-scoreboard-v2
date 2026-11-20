import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

const migrationFile = resolve("supabase/migrations/20261120211330_add_planning_prompt_template_audience.sql");
const profile = {
  admin: "20000000-0000-0000-0000-000000000027",
  inactive: "20000000-0000-0000-0000-000000000028",
  founder: "20000000-0000-0000-0000-000000000029",
  unmapped: "20000000-0000-0000-0000-000000000030",
};

it("defaults to an empty audience and gives only active mapped administrators the audience operations", async () => {
  await resetLocalDatabaseTo("20261120210312");
  await withLocalDatabase(async (client) => {
    await client.query("insert into auth.users (id) select unnest($1::uuid[])", [Object.values(profile)]);
    await client.query(`
      insert into public.profiles (id, auth_user_id, name, platform_role) values
      ('audience-admin', $1, 'Active administrator', 'viewer'),
      ('audience-inactive', $2, 'Inactive administrator', 'ceo'),
      ('audience-founder', $3, 'Founder', 'founder')
    `, [profile.admin, profile.inactive, profile.founder]);
    await client.query(`
      insert into public.administrator_access_grants (profile_id, eligible, active_until) values
      ('audience-admin', true, now() + interval '1 hour'),
      ('audience-inactive', true, now() - interval '1 hour')
    `);
    await client.query("update public.planning_prompt_templates set version = 3 where kind = 'general'");
    await applyMigration(client, migrationFile);

    const as = async (role, userId = "") => {
      await client.query("reset role");
      await client.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
      await client.query(`set role ${role}`);
    };
    const read = () => client.query("select public.administrator_planning_prompt_template_audience() as value");
    const save = (mode, ids = null) => client.query("select public.save_planning_prompt_template_audience($1, $2) as value", [mode, ids]);
    const context = id => client.query("select public.planning_prompt_templates_for_profile($1) as value", [id]);
    const valueOf = async query => (await query).rows[0].value;

    try {
      for (const [role, userId] of [
        ["anon"], ["authenticated", profile.unmapped],
        ["authenticated", profile.founder], ["authenticated", profile.inactive], ["service_role"],
      ]) {
        await as(role, userId);
        await expect(read()).rejects.toMatchObject({ code: "42501" });
        await expect(save("all")).rejects.toMatchObject({ code: "42501" });
      }

      await as("authenticated", profile.admin);
      expect(await valueOf(read())).toMatchObject({
        audience: { mode: "selected", profileIds: [] },
        profiles: expect.arrayContaining([{ id: "audience-founder", name: "Founder" }]),
      });
      await expect(client.query("select * from public.planning_prompt_template_audience_profiles")).rejects.toMatchObject({ code: "42501" });
      await expect(client.query("update public.planning_prompt_template_audience set mode = 'all'")).rejects.toMatchObject({ code: "42501" });
      await expect(context("audience-founder")).rejects.toMatchObject({ code: "42501" });
      await expect(save("selected", ["missing-profile"])).rejects.toMatchObject({ code: "22023" });
      expect((await valueOf(read())).audience).toEqual({ mode: "selected", profileIds: [] });

      await as("service_role");
      expect(await valueOf(context("audience-founder"))).toEqual([]);
      await as("authenticated", profile.admin);
      expect(await valueOf(save(null, ["audience-founder"]))).toEqual({ mode: "selected", profileIds: ["audience-founder"] });
      expect(await valueOf(save("all"))).toEqual({ mode: "all", profileIds: ["audience-founder"] });
      await expect(save(null, [])).rejects.toMatchObject({ code: "22023" });
      await as("service_role");
      expect(await valueOf(context("audience-inactive"))).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "general", version: 3 }),
      ]));
      expect(await valueOf(context("missing-profile"))).toEqual([]);
      await as("authenticated", profile.admin);
      expect(await valueOf(save("selected"))).toEqual({ mode: "selected", profileIds: ["audience-founder"] });
      await as("service_role");
      expect(await valueOf(context("audience-inactive"))).toEqual([]);
      expect(await valueOf(context("audience-founder"))).toHaveLength(4);
    } finally {
      await client.query("reset role");
    }
  });
});
