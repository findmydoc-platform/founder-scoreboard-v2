import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, resetLocalDatabaseTo, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

const migrationFile = resolve("supabase/migrations/20261016170256_grant_server_workweek_observation_confirmation.sql");
const signature = "public.apply_google_team_workweek_observations(uuid,integer,jsonb,timestamptz)";

async function privileges(client) {
  return (await client.query(
    `select has_function_privilege('service_role',$1,'EXECUTE') as server,
       has_function_privilege('authenticated',$1,'EXECUTE') as authenticated,
       has_function_privilege('anon',$1,'EXECUTE') as anonymous`, [signature],
  )).rows[0];
}

it.sequential("grants only server confirmation without changing saved times or function behavior", { timeout: 120_000 }, async () => {
  await resetLocalDatabaseTo("20261016092132");
  await withLocalDatabase(async (client) => {
    await client.query("insert into public.profiles(id,name,platform_role) values('migration-observation-owner','Owner','founder')");
    const version = (await client.query("insert into public.team_workweek_versions(owner_profile_id,effective_from) values('migration-observation-owner','2030-04-01') returning id")).rows[0];
    await client.query("insert into public.team_workweek_windows(version_id,weekday,start_minute,end_minute) values($1,5,540,961)", [version.id]);
    const snapshot = async () => ({
      versions: (await client.query("select * from public.team_workweek_versions where id=$1", [version.id])).rows,
      windows: (await client.query("select * from public.team_workweek_windows where version_id=$1", [version.id])).rows,
      definition: (await client.query("select pg_get_functiondef($1::regprocedure) as value", [signature])).rows[0].value,
    });
    const before = await snapshot();
    expect(await privileges(client)).toEqual({ server: false, authenticated: false, anonymous: false });
    await applyMigration(client, migrationFile);
    expect(await privileges(client)).toEqual({ server: true, authenticated: false, anonymous: false });
    expect(await snapshot()).toEqual(before);
    await applyMigration(client, migrationFile);
    expect(await privileges(client)).toEqual({ server: true, authenticated: false, anonymous: false });
    expect(await snapshot()).toEqual(before);
  });
});
