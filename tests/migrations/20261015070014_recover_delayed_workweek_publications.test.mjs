import { resolve } from "node:path";
import { expect, it } from "vitest";
import { applyMigration, assertRowsPreserved, resetLocalDatabaseTo, snapshotRows, withLocalDatabase } from "./helpers/migration-test-harness.mjs";

it("preserves historical attempts and keeps cancellation evidence inaccessible to client roles", { timeout: 120_000 }, async () => {
  await resetLocalDatabaseTo("20261014153009");
  await withLocalDatabase(async client => {
    await client.query("insert into public.profiles(id,name,platform_role) values('journal-upgrade-owner','Owner','viewer')");
    const version = (await client.query("insert into public.team_workweek_versions(owner_profile_id,effective_from) values('journal-upgrade-owner','2099-01-12') returning id")).rows[0];
    const publication = (await client.query("insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,effective_at,activation_mode,attempt_generation,windows,status,sync_state) values($1,'journal-upgrade-owner','2099-01-12','2099-01-12T00:00:00+01','future_monday',1,'[]','preparing','delayed') returning id", [version.id])).rows[0];
    const payload = { id: "fopsupgradejournal01", start: { dateTime: "2099-01-17T10:30:00Z", timeZone: "Europe/Berlin" }, end: { dateTime: "2099-01-17T15:00:00Z", timeZone: "Europe/Berlin" }, extendedProperties: { private: { founderopsWorkweekGeneration: "1" } } };
    await client.query("insert into public.team_workweek_publication_effects(publication_id,owner_profile_id,generation,kind,google_event_id,payload) values($1,'journal-upgrade-owner',1,'weekly',$2,$3)", [publication.id, payload.id, payload]);
    const contracts = [
      { table: "team_workweek_versions", columns: ["id", "owner_profile_id", "effective_from", "activation_mode", "retired_at", "restarted_version_id"], orderBy: ["id"] },
      { table: "team_workweek_publications", columns: ["id", "source_version_id", "status", "sync_state", "effective_at", "attempt_generation", "windows", "cleanup_history"], orderBy: ["id"] },
      { table: "team_workweek_publication_effects", columns: ["id", "publication_id", "generation", "payload", "state", "cleanup_at", "cleanup_payload"], orderBy: ["id"] },
    ];
    const before = [];
    for (const contract of contracts) before.push(await snapshotRows(client, contract));
    await applyMigration(client, resolve("supabase/migrations/20261015070014_recover_delayed_workweek_publications.sql"));
    for (const [index, contract] of contracts.entries()) assertRowsPreserved(before[index], await snapshotRows(client, contract));
    expect((await client.query("select write_journal_version,restart_requested_at from public.team_workweek_publications where id=$1", [publication.id])).rows[0]).toEqual({ write_journal_version: 0, restart_requested_at: null });
    for (const role of ["anon", "authenticated"]) {
      for (const table of ["team_workweek_provider_operations", "team_workweek_provider_writes"]) {
        expect((await client.query("select has_table_privilege($1,$2,'SELECT') as allowed", [role, `public.${table}`])).rows[0].allowed).toBe(false);
      }
      for (const signature of ["claim_team_workweek_provider_operation(uuid,integer,text)", "record_team_workweek_provider_write(uuid,uuid,text)", "finish_team_workweek_provider_operation(uuid)", "request_team_workweek_publication_restart(uuid,text)"]) {
        expect((await client.query("select has_function_privilege($1,$2,'EXECUTE') as allowed", [role, `public.${signature}`])).rows[0].allowed).toBe(false);
      }
    }
    expect((await client.query("select count(*)::integer as count from public.team_workweek_provider_operations")).rows[0].count).toBe(0);
    assertRowsPreserved(before[2], await snapshotRows(client, contracts[2]));
  });
});
