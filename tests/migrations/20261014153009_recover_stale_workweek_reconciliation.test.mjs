import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, assertRowsPreserved, resetLocalDatabaseTo, snapshotRows, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("upgrades an expired automatic operation without rewriting existing private or physical history", { timeout: 120_000 }, async () => {
  await resetLocalDatabaseTo("20261014122923");
  await withLocalDatabase(async client => {
    const user = "59900000-0000-4000-8000-000000000001";
    await client.query("insert into auth.users(id) values($1)", [user]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('upgrade-owner',$1,'Owner','founder')", [user]);
    const source = (await client.query("insert into public.team_workweek_versions(owner_profile_id,effective_from) values('upgrade-owner','2020-08-31') returning id")).rows[0];
    const base = (await client.query("insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,status,sync_state,published_at,last_sync_at) values($1,'upgrade-owner','2020-08-31','[]','published','confirmed',clock_timestamp(),clock_timestamp()) returning id", [source.id])).rows[0];
    const privateDraft = (await client.query("insert into public.team_workweek_versions(owner_profile_id,effective_from,activation_mode,base_publication_id,base_publication_revision) values('upgrade-owner',date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date,'immediate',$1,1) returning id", [base.id])).rows[0];
    await client.query("insert into public.team_workweek_windows(version_id,weekday,start_minute,end_minute) values($1,1,480,720)", [privateDraft.id]);
    const automatic = (await client.query("insert into public.team_workweek_versions(owner_profile_id,effective_from,activation_mode,origin,base_publication_id,base_publication_revision,google_reconciliation_source_publication_id,google_reconciliation_fingerprint) values('upgrade-owner',date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date,'immediate','google_reconciliation',$1,1,$1,$2) returning id", [base.id, "c".repeat(64)])).rows[0];
    const pending = (await client.query("insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,activation_mode,effective_at,attempt_generation,status,sync_state,windows,publication_revision) values($1,'upgrade-owner',date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date,'immediate',clock_timestamp()-interval '1 hour',1,'preparing','delayed','[]',2) returning id", [automatic.id])).rows[0];
    const physical = { id: "fopsupgradekept", start: { dateTime: "2025-10-26T01:00:00Z", timeZone: "Europe/Berlin" }, end: { dateTime: "2025-10-26T02:00:00Z", timeZone: "Europe/Berlin" }, recurrence: ["RRULE:FREQ=WEEKLY;COUNT=1"] };
    await client.query("insert into public.team_workweek_publication_effects(publication_id,owner_profile_id,generation,kind,google_event_id,payload,state,cleanup_at,cleanup_disposition,cleanup_payload,cleanup_preserved,cleanup_confirmed_etag) values($1,'upgrade-owner',1,'weekly',$2,$3,'cleaned',clock_timestamp(),'preserve',$3,true,'retained')", [pending.id, physical.id, physical]);
    const contracts = [
      { table: "team_workweek_versions", columns: ["id","owner_profile_id","origin","base_publication_id","base_publication_revision","retired_at","restarted_version_id"], orderBy: ["id"] },
      { table: "team_workweek_windows", columns: ["id","version_id","weekday","start_minute","end_minute"], orderBy: ["id"] },
      { table: "team_workweek_publications", columns: ["id","source_version_id","windows","status","publication_revision","effective_at","cleanup_history"], orderBy: ["id"] },
      { table: "team_workweek_publication_effects", columns: ["id","publication_id","payload","state","cleanup_at","cleanup_payload","cleanup_preserved","cleanup_confirmed_etag"], orderBy: ["id"] },
    ];
    const before = []; for (const contract of contracts) before.push(await snapshotRows(client, contract));
    await applyMigration(client, resolve("supabase/migrations/20261014153009_recover_stale_workweek_reconciliation.sql"));
    for (const [index, contract] of contracts.entries()) assertRowsPreserved(before[index], await snapshotRows(client, contract));
    await client.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
    await client.query("select set_config('request.jwt.claim.role','authenticated',false)");
    await client.query("set role authenticated");
    const restarted = (await client.query("select public.restart_private_team_workweek_version($1) as result", [privateDraft.id])).rows[0].result;
    await client.query("reset role");
    expect((await client.query("select status from public.team_workweek_publications where id=$1", [pending.id])).rows[0].status).toBe("inactive");
    expect((await client.query("select start_minute,end_minute from public.team_workweek_windows where version_id=$1", [restarted.versionId])).rows).toEqual([{ start_minute: 480, end_minute: 720 }]);
    assertRowsPreserved(before[3], await snapshotRows(client, contracts[3]));
  });
});
