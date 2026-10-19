import {resolve} from "node:path";
import {expect,it} from "vitest";
import {applyMigration,resetLocalDatabaseTo,withLocalDatabase} from "./helpers/migration-test-harness.mjs";
const migration=resolve("supabase/migrations/20261017094118_coordinate_github_user_credentials.sql");
const functions=[
  "public.store_github_user_connection(text,text,bigint,text,text,timestamptz,timestamptz,uuid,bigint)",
  "public.claim_github_user_refresh(text,uuid,bigint)",
  "public.finalize_github_user_refresh(text,uuid,bigint,uuid,text,text,timestamptz,timestamptz)",
  "public.use_github_user_connection(text,uuid,bigint,boolean)",
];
it.sequential("adds service-only coordination while preserving existing encrypted connections",{timeout:120000},async()=>{
  await resetLocalDatabaseTo("20261016170256");
  await withLocalDatabase(async client=>{
    await client.query("insert into public.profiles(id,name,platform_role,github_login) values('github-vault-migration','Synthetic vault owner','founder','synthetic-author')");
    await client.query("insert into public.github_app_user_tokens(profile_id,github_login,github_user_id,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,refresh_token_expires_at) values('github-vault-migration','synthetic-author',42424242,'synthetic-ciphertext','synthetic-refresh-ciphertext','2030-01-01T00:00:00Z','2030-02-01T00:00:00Z')");
    const snapshot=async()=>(await client.query("select profile_id,github_login,github_user_id,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,refresh_token_expires_at,connected_at,revoked_at from public.github_app_user_tokens where profile_id='github-vault-migration'")).rows;
    const before=await snapshot();
    await applyMigration(client,migration);
    expect(await snapshot()).toEqual(before);
    const binding=(await client.query("select connection_id,credential_version,refresh_claim_id from public.github_app_user_tokens where profile_id='github-vault-migration'")).rows[0];
    expect(binding.connection_id).toMatch(/^[a-f0-9-]{36}$/);expect(binding.credential_version).toBe("0");expect(binding.refresh_claim_id).toBeNull();
    for(const signature of functions) {
      expect((await client.query("select has_function_privilege('service_role',$1,'EXECUTE') as server,has_function_privilege('anon',$1,'EXECUTE') as anonymous,has_function_privilege('authenticated',$1,'EXECUTE') as authenticated",[signature])).rows[0]).toEqual({server:true,anonymous:false,authenticated:false});
    }
    expect((await client.query("select relrowsecurity as enabled from pg_class where oid='public.github_app_user_tokens'::regclass")).rows[0].enabled).toBe(true);
    await applyMigration(client,migration);
    expect(await snapshot()).toEqual(before);
    expect((await client.query("select connection_id from public.github_app_user_tokens where profile_id='github-vault-migration'")).rows[0].connection_id).toBe(binding.connection_id);
  });
});
