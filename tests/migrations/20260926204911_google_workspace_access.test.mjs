import { resolve } from "node:path";
import { it, expect } from "vitest";
import { resetLocalDatabaseTo, withLocalDatabase, applyMigration } from "./helpers/migration-test-harness.mjs";

it("adds Workspace boundaries without changing existing profiles, roles, identities or integration tokens", async () => {
  await resetLocalDatabaseTo("20260924135045");
  await withLocalDatabase(async client => {
    const uid = "62000000-0000-0000-0000-000000000001";
    await client.query("insert into auth.users(id,email) values ($1,'github-address@example.com')", [uid]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role,github_login) values ('migration-founder',$1,'Founder','founder','github-founder')", [uid]);
    await client.query("insert into public.github_app_user_tokens(profile_id,github_login,encrypted_access_token,encrypted_refresh_token) values ('migration-founder','github-founder','v1.a.b.c','v1.d.e.f')");
    await client.query("insert into public.google_workspace_connections(profile_id,encrypted_access_token,encrypted_refresh_token,access_token_expires_at) values ('migration-founder','v1.a.b.c','v1.d.e.f',now()+interval '1 hour')");
    const calendarBefore = (await client.query("select * from public.google_workspace_connections")).rows;
    const profileBefore = (await client.query("select * from public.profiles where id='migration-founder'")).rows;
    const usersBefore = (await client.query("select id,email from auth.users where id=$1", [uid])).rows;
    const tokensBefore = (await client.query("select * from public.github_app_user_tokens")).rows;
    await applyMigration(client, resolve("supabase/migrations/20260926204911_google_workspace_access.sql"));
    expect((await client.query("select * from public.profiles where id='migration-founder'")).rows).toEqual(profileBefore);
    expect((await client.query("select id,email from auth.users where id=$1", [uid])).rows).toEqual(usersBefore);
    expect((await client.query("select * from public.github_app_user_tokens")).rows).toEqual(tokensBefore);
    expect((await client.query("select * from public.google_workspace_connections")).rows).toEqual(calendarBefore);
    expect((await client.query("select mode from workspace_private.configuration")).rows[0].mode).toBe("legacy");
    expect((await client.query("select public from storage.buckets where id='fmd-tool-previews'")).rows[0].public).toBe(false);
    for (const role of ["anon", "authenticated"]) {
      expect((await client.query("select has_function_privilege($1,'public.workspace_complete_link(uuid,text,text)','execute') as allowed", [role])).rows[0].allowed).toBe(false);
    }
  });
});
