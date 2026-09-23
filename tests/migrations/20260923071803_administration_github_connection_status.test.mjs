import { resolve } from "node:path";
import { expect, it } from "vitest";
import {
  applyMigration,
  resetLocalDatabaseTo,
  withLocalDatabase,
} from "./helpers/migration-test-harness.mjs";

const previousVersion = "20260922134227";
const migrationFile = resolve(
  process.cwd(),
  "supabase/migrations/20260923071803_administration_github_connection_status.sql",
);

const users = {
  actor: "20000000-0000-0000-0000-000000000001",
  active: "20000000-0000-0000-0000-000000000002",
  prepared: "20000000-0000-0000-0000-000000000003",
  mismatch: "20000000-0000-0000-0000-000000000004",
  missingLogin: "20000000-0000-0000-0000-000000000005",
  noIdentity: "20000000-0000-0000-0000-000000000006",
  multiple: "20000000-0000-0000-0000-000000000007",
};

async function asAuthenticated(client, authUserId, callback) {
  await client.query("select set_config('request.jwt.claim.sub', $1, false)", [authUserId]);
  await client.query("select set_config('request.jwt.claim.role', 'authenticated', false)");
  await client.query("set role authenticated");
  try {
    return await callback();
  } finally {
    await client.query("reset role");
    await client.query("select set_config('request.jwt.claim.sub', '', false)");
    await client.query("select set_config('request.jwt.claim.role', '', false)");
  }
}

it("projects GitHub connection status only for active administrators", {
  timeout: 120_000,
}, async () => {
  await resetLocalDatabaseTo(previousVersion);

  await withLocalDatabase(async (client) => {
    await client.query(
      "insert into auth.users (id) select unnest($1::uuid[])",
      [Object.values(users)],
    );
    await client.query(`
      insert into public.profiles (id, auth_user_id, name, platform_role, github_login)
      values
        ('status-actor', '${users.actor}', 'Actor', 'ceo', 'actor'),
        ('status-active', '${users.active}', 'Active', 'founder', 'active-login'),
        ('status-prepared', '${users.prepared}', 'Prepared', 'founder', 'prepared-login'),
        ('status-mismatch', '${users.mismatch}', 'Mismatch', 'viewer', 'expected-login'),
        ('status-missing-login', '${users.missingLogin}', 'Missing login', 'viewer', ''),
        ('status-no-auth', null, 'No auth', 'viewer', 'no-auth-login'),
        ('status-no-identity', '${users.noIdentity}', 'No identity', 'viewer', 'no-identity-login'),
        ('status-multiple', '${users.multiple}', 'Multiple', 'viewer', 'multiple-login')
    `);
    await client.query(`
      insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at)
      values
        ('actor-provider', '${users.actor}', '{"user_name":"actor"}', 'github', clock_timestamp()),
        ('active-provider', '${users.active}', '{"user_name":"ACTIVE-LOGIN","access_token":"SHOULD_NOT_LEAK"}', 'github', '2026-09-22T11:45:00Z'),
        ('prepared-provider', '${users.prepared}', '{"user_name":"prepared-login"}', 'github', null),
        ('mismatch-provider', '${users.mismatch}', '{"user_name":"different-login"}', 'github', clock_timestamp()),
        ('missing-login-provider', '${users.missingLogin}', '{"user_name":"configured-provider-login"}', 'github', clock_timestamp()),
        ('multiple-provider-a', '${users.multiple}', '{"user_name":"multiple-login"}', 'github', clock_timestamp()),
        ('multiple-provider-b', '${users.multiple}', '{"user_name":"other-login"}', 'github', clock_timestamp())
    `);
    await client.query(`
      insert into public.administrator_access_grants (profile_id, eligible, active_until)
      values ('status-actor', true, null)
    `);

    await applyMigration(client, migrationFile);

    await asAuthenticated(client, users.actor, async () => {
      const ceoDirectory = await client.query("select public.administrator_directory_snapshot() as directory");
      expect(ceoDirectory.rows[0].directory.people.every((person) => person.githubLogin === "")).toBe(true);
      expect(ceoDirectory.rows[0].directory.people.every((person) => person.githubConnection === null)).toBe(true);

      await client.query("select public.activate_administrator_access()");
      const adminDirectory = await client.query("select public.administrator_directory_snapshot() as directory");
      const people = new Map(adminDirectory.rows[0].directory.people.map((person) => [person.id, person]));

      expect(people.get("status-active").githubConnection).toEqual({
        status: "active",
        description: "GitHub ist aktiv mit FounderOps verbunden.",
        lastSignInAt: "2026-09-22T11:45:00+00:00",
      });
      expect(people.get("status-prepared").githubConnection).toMatchObject({
        status: "prepared",
        lastSignInAt: null,
      });
      expect(people.get("status-mismatch").githubConnection).toMatchObject({
        status: "incomplete",
        description: "GitHub-Login und GitHub-Identität stimmen nicht überein.",
      });
      expect(people.get("status-missing-login").githubConnection).toMatchObject({
        status: "incomplete",
        description: "GitHub-Login fehlt.",
      });
      expect(people.get("status-no-auth").githubConnection).toMatchObject({
        status: "incomplete",
        description: "Das Profil ist noch keiner FounderOps-Anmeldung zugeordnet.",
      });
      expect(people.get("status-no-identity").githubConnection).toMatchObject({
        status: "incomplete",
        description: "Der FounderOps-Anmeldung ist keine GitHub-Identität zugeordnet.",
      });
      expect(people.get("status-multiple").githubConnection).toMatchObject({
        status: "incomplete",
        description: "Die GitHub-Identität ist nicht eindeutig.",
      });
      expect(JSON.stringify(adminDirectory.rows[0].directory)).not.toContain(users.active);
      expect(JSON.stringify(adminDirectory.rows[0].directory)).not.toContain("provider_id");
      expect(JSON.stringify(adminDirectory.rows[0].directory)).not.toContain("SHOULD_NOT_LEAK");
    });
  });
});
