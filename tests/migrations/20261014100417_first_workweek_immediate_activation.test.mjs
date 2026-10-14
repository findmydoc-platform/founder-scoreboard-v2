import {resolve} from "node:path";
import {expect,it} from "vitest";
import {applyMigration,assertRowsPreserved,resetLocalDatabaseTo,snapshotRows,withLocalDatabase} from "./helpers/migration-test-harness.mjs";

it("preserves legacy draft, publication and Google identities while introducing service-only temporal confirmation",{timeout:120_000},async()=>{
  await resetLocalDatabaseTo("20261013123257");
  await withLocalDatabase(async client=>{
    await client.query("insert into auth.users(id) values('51000000-0000-4000-8000-000000000001')");
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('temporal-legacy','51000000-0000-4000-8000-000000000001','Legacy','viewer')");
    await client.query("insert into public.team_workweek_versions(id,owner_profile_id,effective_from) values('51000000-0000-4000-8000-000000000002','temporal-legacy','2026-03-23')");
    await client.query("insert into public.team_workweek_windows(id,version_id,weekday,start_minute,end_minute) values(5101,'51000000-0000-4000-8000-000000000002',7,540,1020)");
    await client.query(`insert into public.team_workweek_publications(id,source_version_id,owner_profile_id,effective_from,windows,status,sync_state,published_at,last_sync_at,publication_revision)
      values('51000000-0000-4000-8000-000000000003','51000000-0000-4000-8000-000000000002','temporal-legacy','2026-03-23','[{"weekday":7,"startMinute":540,"endMinute":1020}]','published','confirmed','2026-03-20T12:00:00Z','2026-03-20T12:00:00Z',1)`);
    await client.query(`insert into public.team_workweek_google_series(id,publication_id,source_window_id,owner_profile_id,google_event_id,state,confirmed_etag,confirmed_founderops_revision,last_confirmed_at)
      values('51000000-0000-4000-8000-000000000004','51000000-0000-4000-8000-000000000003',5101,'temporal-legacy','fopsabc001','confirmed','legacy-etag',1,'2026-03-20T12:00:00Z')`);
    const contracts=[
      {table:"team_workweek_versions",columns:["id","owner_profile_id","effective_from","status","origin"],orderBy:["id"]},
      {table:"team_workweek_windows",columns:["id","version_id","weekday","start_minute","end_minute"],orderBy:["id"]},
      {table:"team_workweek_publications",columns:["id","source_version_id","owner_profile_id","effective_from","effective_to","windows","status","sync_state","published_at","last_sync_at","publication_revision"],orderBy:["id"]},
      {table:"team_workweek_google_series",columns:["id","publication_id","source_window_id","google_event_id","confirmed_etag","confirmed_founderops_revision"],orderBy:["id"]},
    ];
    const before=[];for(const contract of contracts)before.push(await snapshotRows(client,contract));
    await applyMigration(client,resolve("supabase/migrations/20261014100417_first_workweek_immediate_activation.sql"));
    const after=[];for(const contract of contracts)after.push(await snapshotRows(client,contract));
    before.forEach((snapshot,index)=>assertRowsPreserved(snapshot,after[index]));
    const legacy=await client.query("select activation_mode,effective_at from public.team_workweek_publications where owner_profile_id='temporal-legacy'");
    expect(legacy.rows).toEqual([{activation_mode:"future_monday",effective_at:null}]);
    await client.query("select set_config('request.jwt.claim.sub','51000000-0000-4000-8000-000000000001',false)");
    await client.query("set role authenticated");
    await expect(client.query("select public.create_private_immediate_team_workweek_version('[]')")).rejects.toMatchObject({code:"22023"});
    await expect(client.query("select public.confirm_team_workweek_effect(null,1,'etag','{}')")).rejects.toMatchObject({code:"42501"});
    await expect(client.query("select public.prepare_monday_team_workweek_publication(null)")).rejects.toMatchObject({code:"42501"});
    await client.query("reset role");
  });
});
