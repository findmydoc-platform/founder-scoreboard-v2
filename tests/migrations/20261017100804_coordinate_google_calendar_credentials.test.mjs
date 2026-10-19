import {resolve} from "node:path";
import {expect,it} from "vitest";
import {applyMigration,resetLocalDatabaseTo,withLocalDatabase} from "./helpers/migration-test-harness.mjs";
const migration=resolve("supabase/migrations/20261017100804_coordinate_google_calendar_credentials.sql");
const functions=[
  "public.store_google_calendar_connection(text,text,text,timestamptz,timestamptz,uuid,bigint)",
  "public.claim_google_calendar_refresh(text,uuid,bigint)",
  "public.finalize_google_calendar_refresh(text,uuid,bigint,uuid,text,text,timestamptz,timestamptz,text)",
  "public.use_google_calendar_connection(text,uuid,bigint)",
  "public.remove_google_calendar_connection(text,uuid)",
];
it.sequential("adds service-only coordination while preserving existing encrypted connections",{timeout:120000},async()=>{
  await resetLocalDatabaseTo("20261017094118");
  await withLocalDatabase(async client=>{
    await client.query("insert into public.profiles(id,name,platform_role) values('calendar-vault-migration','Synthetic vault owner','viewer')");
    await client.query("insert into public.google_workspace_connections(profile_id,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,refresh_token_expires_at,oauth_scopes,token_type,primary_calendar_id) values('calendar-vault-migration','v1.a.b.c','v1.d.e.f','2030-01-01T00:00:00Z','2030-02-01T00:00:00Z',array['https://www.googleapis.com/auth/calendar.events.owned'],'Bearer','primary')");
    const snapshot=async()=>(await client.query("select profile_id,oauth_scopes,token_type,primary_calendar_id,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,refresh_token_expires_at,connected_at,revoked_at from public.google_workspace_connections where profile_id='calendar-vault-migration'")).rows;
    const before=await snapshot();
    const operation=(await client.query("insert into public.google_workspace_disconnect_operations(owner_profile_id,requested_by,revoke_connection,cutoff_date) values('calendar-vault-migration','owner',true,current_date) returning id")).rows[0];
    await applyMigration(client,migration);
    expect(await snapshot()).toEqual(before);
    const binding=(await client.query("select connection_id,credential_version,refresh_claim_id from public.google_workspace_connections where profile_id='calendar-vault-migration'")).rows[0];
    expect((await client.query("select connection_id from public.google_workspace_disconnect_operations where id=$1",[operation.id])).rows[0].connection_id).toBe(binding.connection_id);
    expect(binding.connection_id).toMatch(/^[a-f0-9-]{36}$/);expect(binding.credential_version).toBe("0");expect(binding.refresh_claim_id).toBeNull();
    for(const signature of functions) {
      expect((await client.query("select has_function_privilege('service_role',$1,'EXECUTE') as server,has_function_privilege('anon',$1,'EXECUTE') as anonymous,has_function_privilege('authenticated',$1,'EXECUTE') as authenticated",[signature])).rows[0]).toEqual({server:true,anonymous:false,authenticated:false});
    }
    expect((await client.query("select relrowsecurity as enabled from pg_class where oid='public.google_workspace_connections'::regclass")).rows[0].enabled).toBe(true);
    await applyMigration(client,migration);
    expect(await snapshot()).toEqual(before);
    expect((await client.query("select connection_id from public.google_workspace_connections where profile_id='calendar-vault-migration'")).rows[0].connection_id).toBe(binding.connection_id);
  });
});
