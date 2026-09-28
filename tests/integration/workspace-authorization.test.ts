import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { asAuthenticated, captureDatabaseError, withIsolatedLocalDatabase } from "./helpers/local-database";

const uid = "61000000-0000-0000-0000-000000000001";
const sessionId = "63000000-0000-0000-0000-000000000001";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

it("requires a server permit in addition to the existing user role and consumes write permits", async () => {
  await withIsolatedLocalDatabase(async client => {
    await client.query("insert into auth.users(id) values ($1)", [uid]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values ('workspace-founder',$1,'Workspace Founder','founder')", [uid]);
    await client.query("insert into workspace_private.identity_bindings(user_id,google_subject) values ($1,'google-1')", [uid]);
    await client.query("update workspace_private.configuration set mode = 'google'");
    await client.query("insert into auth.sessions(id,user_id,created_at) values ($1,$2,clock_timestamp())", [sessionId, uid]);
    await client.query("select set_config('request.method','POST',true), set_config('request.path','/rpc/current_authenticated_profile',true)");
    const denied = await captureDatabaseError(client, () => asAuthenticated(client, uid, () => client.query("select public.workspace_check_request()")));
    expect(denied).toMatchObject({ code: "42501" });
    await client.query("select public.workspace_issue_permit($1,$2,$3,'POST','/rpc/current_authenticated_profile',$4)", [digest("permit"), uid, digest("token"), sessionId]);
    await client.query("select set_config('request.headers',$1,true)", [JSON.stringify({ authorization: "Bearer token", "x-founderops-workspace-permit": "permit" })]);
    await asAuthenticated(client, uid, async () => {
      await client.query("select public.workspace_check_request()");
      const profile = await client.query("select public.current_authenticated_profile() as profile");
      expect(profile.rows[0].profile.id).toBe("workspace-founder");
    });
    const replay = await captureDatabaseError(client, () => asAuthenticated(client, uid, () => client.query("select public.workspace_check_request()")));
    expect(replay).toMatchObject({ code: "42501" });
    const issue = await captureDatabaseError(client, () => asAuthenticated(client, uid, () => client.query("select public.workspace_issue_permit('forged',$1,'token','GET','/profiles',$2)", [uid, sessionId])));
    expect(issue).toMatchObject({ code: "42501" });
  });
});

it("denies direct table and Storage reads without a trusted request and preserves stored identities", async () => {
  await withIsolatedLocalDatabase(async client => {
    await client.query("insert into auth.users(id) values ($1)", [uid]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values ('workspace-founder',$1,'Workspace Founder','founder')", [uid]);
    await client.query("update workspace_private.configuration set mode = 'google'");
    await asAuthenticated(client, uid, async () => {
      expect((await client.query("select id from public.profiles")).rows).toEqual([]);
      expect((await client.query("select id from storage.objects")).rows).toEqual([]);
    });
    expect((await client.query("select auth_user_id,platform_role from public.profiles where id='workspace-founder'")).rows[0]).toEqual({ auth_user_id: uid, platform_role: "founder" });
    expect((await client.query("select public from storage.buckets where id='fmd-tool-previews'")).rows[0].public).toBe(false);
  });
});

it.each(["wrong-token", "wrong-path", "expired"])("rejects %s permits", async scenario => {
  await withIsolatedLocalDatabase(async client => {
    await client.query("insert into auth.users(id) values ($1)", [uid]);
    await client.query("insert into workspace_private.identity_bindings(user_id,google_subject) values ($1,'google-1')", [uid]);
    await client.query("update workspace_private.configuration set mode='google'");
    await client.query("insert into auth.sessions(id,user_id,created_at) values ($1,$2,clock_timestamp())", [sessionId, uid]);
    await client.query("select public.workspace_issue_permit($1,$2,$3,'GET','/profiles',$4)", [digest("permit"), uid, digest("token"), sessionId]);
    if (scenario === "expired") await client.query("update workspace_private.request_permits set expires_at = now()-interval '1 second'");
    await client.query("select set_config('request.method','GET',true),set_config('request.path',$1,true),set_config('request.headers',$2,true)", [scenario === "wrong-path" ? "/tasks" : "/profiles", JSON.stringify({ authorization: scenario === "wrong-token" ? "Bearer other" : "Bearer token", "x-founderops-workspace-permit": "permit" })]);
    expect(await captureDatabaseError(client, () => asAuthenticated(client, uid, () => client.query("select public.workspace_check_request()")))).toMatchObject({ code: "42501" });
  });
});

it("links differing email identities to the existing profile and rejects mismatched or reused attempts", async () => {
  await withIsolatedLocalDatabase(async client => {
    await client.query("insert into auth.users(id,email) values ($1,'github@example.com')", [uid]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values ('workspace-founder',$1,'Workspace Founder','founder')", [uid]);
    await client.query("insert into auth.identities(user_id,provider,provider_id,identity_data) values ($1,'google','workspace-sub',$2)", [uid,JSON.stringify({ sub:"workspace-sub", iss:"https://accounts.google.com", email:"workspace@findmydoc.eu",email_verified:true,custom_claims:{hd:"findmydoc.eu"} })]);
    await client.query("update workspace_private.configuration set mode='linking'");
    await client.query("select public.workspace_begin_link($1,'nonce')", [uid]);
    const mismatch = await captureDatabaseError(client, () => client.query("select public.workspace_complete_link($1,'nonce','other-sub')", [uid]));
    expect(mismatch).toMatchObject({ code:"42501" });
    await client.query("select public.workspace_complete_link($1,'nonce','workspace-sub')", [uid]);
    const context = (await client.query("select public.workspace_access_context($1,null) as context", [uid])).rows[0].context;
    expect(context.linked).toBe(true);
    expect(context.userId).toBe(uid);
    expect(context.profileId).toBe("workspace-founder");
    expect((await client.query("select platform_role from public.profiles where id='workspace-founder'")).rows[0].platform_role).toBe("founder");
    expect(await captureDatabaseError(client, () => client.query("select public.workspace_complete_link($1,'nonce','workspace-sub')", [uid]))).toMatchObject({ code:"42501" });
  });
});

it("keeps linking open until activation and then denies direct database access", async () => {
  await withIsolatedLocalDatabase(async client => {
    await client.query("insert into auth.users(id) values ($1)", [uid]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values ('workspace-founder',$1,'Workspace Founder','founder')", [uid]);
    await client.query("update workspace_private.configuration set mode='linking'");
    await client.query("select set_config('request.method','GET',true),set_config('request.path','/profiles',true)");
    await asAuthenticated(client, uid, () => client.query("select public.workspace_check_request()"));
    await client.query("update workspace_private.configuration set linking_enforced=true");
    expect(await captureDatabaseError(client, () => asAuthenticated(client, uid, () => client.query("select public.workspace_check_request()")))).toMatchObject({ code: "42501" });
    await asAuthenticated(client, uid, async () => {
      expect((await client.query("select id from public.profiles")).rows).toEqual([]);
    });
  });
});

it("admits only a server-approved Google login session for the bound user", async () => {
  await withIsolatedLocalDatabase(async client => {
    const sessionId = "63000000-0000-0000-0000-000000000001";
    await client.query("insert into auth.users(id) values ($1)", [uid]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values ('workspace-founder',$1,'Workspace Founder','founder')", [uid]);
    await client.query("insert into auth.identities(user_id,provider,provider_id,identity_data) values ($1,'google','workspace-sub',$2)", [uid, JSON.stringify({ sub: "workspace-sub", iss: "https://accounts.google.com", email: "member@findmydoc.eu", email_verified: true, custom_claims: { hd: "findmydoc.eu" } })]);
    await client.query("insert into workspace_private.identity_bindings(user_id,google_subject) values ($1,'workspace-sub')", [uid]);
    await client.query("insert into auth.sessions(id,user_id,created_at) values ($1,$2,now())", [sessionId, uid]);
    await client.query("update workspace_private.configuration set mode='linking', linking_enforced=true");
    expect((await client.query("select public.workspace_linking_session_allowed($1,$2) as allowed", [uid, sessionId])).rows[0].allowed).toBe(false);
    expect(await captureDatabaseError(client, () => client.query("select public.workspace_record_google_login($1,$2,'wrong-sub')", [uid, sessionId]))).toMatchObject({ code: "42501" });
    await client.query("select public.workspace_record_google_login($1,$2,'workspace-sub')", [uid, sessionId]);
    expect((await client.query("select public.workspace_linking_session_allowed($1,$2) as allowed", [uid, sessionId])).rows[0].allowed).toBe(true);
    expect(await captureDatabaseError(client, () => asAuthenticated(client, uid, () => client.query("select public.workspace_record_google_login($1,$2,'workspace-sub')", [uid, sessionId])))).toMatchObject({ code: "42501" });
  });
});

it("rejects a linking permit after the Google-only cutover", async () => {
  await withIsolatedLocalDatabase(async client => {
    await client.query("insert into auth.users(id) values ($1)", [uid]);
    await client.query("insert into public.profiles(id,auth_user_id,name,platform_role) values ('workspace-founder',$1,'Workspace Founder','founder')", [uid]);
    await client.query("insert into auth.identities(user_id,provider,provider_id,identity_data) values ($1,'google','workspace-sub',$2)", [uid, JSON.stringify({ sub: "workspace-sub", iss: "https://accounts.google.com", email: "member@findmydoc.eu", email_verified: true, custom_claims: { hd: "findmydoc.eu" } })]);
    await client.query("insert into workspace_private.identity_bindings(user_id,google_subject) values ($1,'workspace-sub')", [uid]);
    await client.query("insert into auth.sessions(id,user_id,created_at) values ($1,$2,now())", [sessionId, uid]);
    await client.query("update workspace_private.configuration set mode='linking', linking_enforced=true");
    await client.query("select public.workspace_record_google_login($1,$2,'workspace-sub')", [uid, sessionId]);
    await client.query("select public.workspace_issue_permit($1,$2,$3,'POST','/rpc/current_authenticated_profile',$4)", [digest("stale-permit"), uid, digest("token"), sessionId]);
    const before = (await client.query("select access_generation from workspace_private.configuration")).rows[0].access_generation;
    await client.query("update workspace_private.configuration set mode='google'");
    expect(BigInt((await client.query("select access_generation from workspace_private.configuration")).rows[0].access_generation)).toBeGreaterThan(BigInt(before));
    await client.query("select set_config('request.method','POST',true),set_config('request.path','/rpc/current_authenticated_profile',true),set_config('request.headers',$1,true)", [JSON.stringify({ authorization: "Bearer token", "x-founderops-workspace-permit": "stale-permit" })]);
    expect(await captureDatabaseError(client, () => asAuthenticated(client, uid, () => client.query("select public.workspace_check_request()")))).toMatchObject({ code: "42501" });
    expect(await captureDatabaseError(client, () => client.query("select public.workspace_issue_permit($1,$2,$3,'POST','/rpc/current_authenticated_profile',$4)", [digest("new-permit"), uid, digest("token"), sessionId]))).toMatchObject({ code: "42501" });
  });
});
