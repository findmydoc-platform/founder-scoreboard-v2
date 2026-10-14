import {resolve} from "node:path";
import {expect,it} from "vitest";
import {applyMigration,assertRowsPreserved,resetLocalDatabaseTo,snapshotRows,withLocalDatabase} from "./helpers/migration-test-harness.mjs";

it("preserves legacy drafts, prepared cleanup and all physical publication history",{timeout:120_000},async()=>{
  await resetLocalDatabaseTo("20261014114827");
  await withLocalDatabase(async client=>{
    await client.query("insert into auth.users(id) values('56000000-0000-4000-8000-000000000001')");
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values('seasonal-legacy','56000000-0000-4000-8000-000000000001','Legacy','viewer')");
    await client.query("insert into public.team_workweek_versions(id,owner_profile_id,effective_from) values('56000000-0000-4000-8000-000000000002','seasonal-legacy','2026-03-23')");
    await client.query("insert into public.team_workweek_windows(id,version_id,weekday,start_minute,end_minute) values(5601,'56000000-0000-4000-8000-000000000002',7,60,240)");
    await client.query(`insert into public.team_workweek_publications(id,source_version_id,owner_profile_id,effective_from,windows,status,sync_state,published_at,last_sync_at,publication_revision)
      values('56000000-0000-4000-8000-000000000003','56000000-0000-4000-8000-000000000002','seasonal-legacy','2026-03-23','[{"weekday":7,"startMinute":60,"endMinute":240}]','published','confirmed','2026-03-20T12:00:00Z','2026-03-20T12:00:00Z',1)`);
    await client.query(`insert into public.team_workweek_google_series(id,publication_id,source_window_id,owner_profile_id,google_event_id,state,confirmed_etag,confirmed_founderops_revision,last_confirmed_at)
      values('56000000-0000-4000-8000-000000000004','56000000-0000-4000-8000-000000000003',5601,'seasonal-legacy','fopsabc001','confirmed','legacy-etag',1,'2026-03-20T12:00:00Z')`);
    await client.query(`insert into public.team_workweek_publication_effects(publication_id,owner_profile_id,generation,series_id,kind,google_event_id,payload,state,confirmed_etag,observed_at)
      values('56000000-0000-4000-8000-000000000003','seasonal-legacy',1,'56000000-0000-4000-8000-000000000004','weekly','fopsabc001',
        '{"id":"fopsabc001","start":{"dateTime":"2026-03-29T00:00:00Z","timeZone":"Europe/Berlin"},"end":{"dateTime":"2026-03-29T02:00:00Z","timeZone":"Europe/Berlin"},"recurrence":["RRULE:FREQ=WEEKLY"],"extendedProperties":{"private":{"founderopsWorkweekSeriesId":"56000000-0000-4000-8000-000000000004","founderopsWorkweekRevision":"1"}}}',
        'confirmed','legacy-etag','2026-03-20T12:00:00Z')`);
    await client.query("insert into public.team_workweek_versions(id,owner_profile_id,effective_from) values('58000000-0000-4000-8000-000000000001','seasonal-legacy','2030-04-01')");
    await client.query(`insert into public.team_workweek_publications(id,source_version_id,owner_profile_id,effective_from,windows,status,sync_state,published_at,last_sync_at,publication_revision)
      values('58000000-0000-4000-8000-000000000002','58000000-0000-4000-8000-000000000001','seasonal-legacy','2030-04-01','[]','published','confirmed','2026-03-20T12:00:00Z','2026-03-20T12:00:00Z',2)`);
    await client.query("update public.team_workweek_publications set effective_to='2030-03-31',superseded_by_publication_id='58000000-0000-4000-8000-000000000002' where id='56000000-0000-4000-8000-000000000003'");
    await client.query("insert into public.google_workspace_disconnect_operations(id,owner_profile_id,requested_by,revoke_connection,cutoff_date,state) values('59600000-0000-4000-8000-000000000001','seasonal-legacy','owner',true,'2030-04-01','cleaning')");
    await client.query("insert into public.google_workspace_disconnect_series(operation_id,series_id,google_event_id,expected_etag,expected_founderops_revision,cleanup_action,recurrence_count) values('59600000-0000-4000-8000-000000000001','56000000-0000-4000-8000-000000000004','fopsabc001','legacy-etag',1,'truncate',4)");
    const contracts=[
      {table:"google_workspace_disconnect_operations",columns:["id","owner_profile_id","cutoff_date","state","requested_by"],orderBy:["id"]},
      {table:"google_workspace_disconnect_series",columns:["id","operation_id","series_id","google_event_id","expected_etag","cleanup_action","recurrence_count","state"],orderBy:["id"]},
      {table:"team_workweek_publication_effects",columns:["id","publication_id","series_id","generation","payload","state","confirmed_etag"],orderBy:["id"]},
      {table:"team_workweek_windows",columns:["id","version_id","weekday","start_minute","end_minute"],orderBy:["id"]},
      {table:"team_workweek_publications",columns:["id","source_version_id","effective_from","effective_to","windows","status","publication_revision"],orderBy:["id"]},
      {table:"team_workweek_google_series",columns:["id","publication_id","source_window_id","google_event_id","confirmed_etag","confirmed_founderops_revision"],orderBy:["id"]},
    ];
    const before=[];for(const contract of contracts)before.push(await snapshotRows(client,contract));
    await applyMigration(client,resolve("supabase/migrations/20261014122923_reconcile_temporal_workweek_projections.sql"));
    const after=[];for(const contract of contracts)after.push(await snapshotRows(client,contract));
    before.forEach((snapshot,index)=>assertRowsPreserved(snapshot,after[index]));
    await client.query("set role authenticated");
    await expect(client.query("select public.team_workweek_successor_snapshot('seasonal-legacy')")).rejects.toMatchObject({code:"42501"});
    await expect(client.query("select public.plan_team_workweek_civil_effects(null)")).rejects.toMatchObject({code:"42501"});
    await client.query("reset role");
    expect((await client.query("select successor_snapshot,successor_publication_id from public.team_workweek_publications where owner_profile_id='seasonal-legacy'")).rows).toEqual([{successor_snapshot:null,successor_publication_id:null},{successor_snapshot:null,successor_publication_id:null}]);
    expect((await client.query("select effect_plan from public.google_workspace_disconnect_series")).rows).toEqual([{effect_plan:null}]);
    expect((await client.query("select retired_at,restarted_version_id from public.team_workweek_versions")).rows.every(row=>row.retired_at===null && row.restarted_version_id===null)).toBe(true);
  });
});
