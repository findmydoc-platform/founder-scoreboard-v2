import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import pg from "pg";
import { expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { importTestModule } from "../helpers/vitest-module.mjs";

it("private draft HTTP entry retains JWT permits, owner isolation and owner-bound save contexts", async () => {
  const { stdout } = await promisify(execFile)(resolve("node_modules/.bin/supabase"), ["status", "-o", "json"]);
  const local = JSON.parse(stdout);
  if (!new Set(["localhost", "127.0.0.1"]).has(new URL(local.API_URL).hostname)) throw new Error("Local test target required");
  const database = new pg.Client(local.DB_URL);
  await database.connect();
  const owners = Array.from({length:2}, () => ({userId:randomUUID(),sessionId:randomUUID(),subject:randomUUID(),profileId:`draft-${randomUUID()}`}));
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now()/1000);
  const tokens = owners.map(owner => {
    const unsigned = `${encode({alg:"HS256",typ:"JWT"})}.${encode({iss:`${local.API_URL}/auth/v1`,sub:owner.userId,aud:"authenticated",role:"authenticated",session_id:owner.sessionId,iat:now,exp:now+3600,amr:[{method:"oauth",timestamp:now}]})}`;
    return `${unsigned}.${createHmac("sha256",local.JWT_SECRET).update(unsigned).digest("base64url")}`;
  });
  const originalFetch = globalThis.fetch;
  const previous = (await database.query("select mode,linking_enforced from workspace_private.configuration")).rows[0];
  try {
    for (const [index,owner] of owners.entries()) {
      await database.query("insert into auth.users(id,email,role,aud,email_confirmed_at) values ($1,$2,'authenticated','authenticated',now())",[owner.userId,`synthetic-draft-${index}@example.test`]);
      await database.query("insert into public.profiles(id,auth_user_id,name,platform_role) values ($1,$2,'Synthetic Draft','founder')",[owner.profileId,owner.userId]);
      await database.query("insert into auth.identities(user_id,provider,provider_id,identity_data) values ($1,'google',$2,$3)",[owner.userId,owner.subject,JSON.stringify({sub:owner.subject,iss:"https://accounts.google.com",email:`synthetic-draft-${index}@findmydoc.eu`,email_verified:true,custom_claims:{hd:"findmydoc.eu"}})]);
      await database.query("insert into workspace_private.identity_bindings(user_id,google_subject) values ($1,$2)",[owner.userId,owner.subject]);
      await database.query("insert into auth.sessions(id,user_id,created_at) values ($1,$2,now())",[owner.sessionId,owner.userId]);
    }
    await database.query("update workspace_private.configuration set mode='linking',linking_enforced=true");
    for (const owner of owners) await database.query("select public.workspace_record_google_login($1,$2,$3)",[owner.userId,owner.sessionId,owner.subject]);
    for (const [name,value] of Object.entries({NEXT_PUBLIC_SUPABASE_URL:local.API_URL,SUPABASE_URL:local.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:local.ANON_KEY,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,SUPABASE_ANON_KEY:local.ANON_KEY,SUPABASE_PUBLISHABLE_KEY:local.ANON_KEY,SUPABASE_SERVICE_ROLE_KEY:local.SERVICE_ROLE_KEY,SUPABASE_SECRET_KEY:local.SERVICE_ROLE_KEY,GOOGLE_WORKLOAD_IDENTITY_AUDIENCE:"synthetic-draft-audience",GOOGLE_WORKSPACE_SERVICE_ACCOUNT:"synthetic-draft@example.test",GOOGLE_AUTHORIZED_GROUP:"internal-tool-founder-ops-access@findmydoc.eu",VERCEL_OIDC_TOKEN:tokens[0]})) vi.stubEnv(name,value);
    vi.stubGlobal("fetch",async (input: RequestInfo | URL,init?: RequestInit) => {
      const request = new Request(input,init); const url = new URL(request.url);
      if (url.pathname === "/auth/v1/user") {
        const index = tokens.findIndex(token => request.headers.get("authorization") === `Bearer ${token}`);
        return index >= 0 ? Response.json({id:owners[index].userId,aud:"authenticated",role:"authenticated",identities:[]}) : Response.json({message:"Invalid credential"},{status:401});
      }
      if (url.hostname === "sts.googleapis.com") return Response.json({access_token:"synthetic-sts"});
      if (url.hostname === "iamcredentials.googleapis.com") return Response.json({accessToken:"synthetic-reader",expireTime:new Date(Date.now()+3600000).toISOString()});
      if (url.hostname === "admin.googleapis.com") return Response.json({isMember:true});
      if (url.origin !== new URL(local.API_URL).origin) throw new Error("Unexpected external provider in private draft test");
      return originalFetch(request);
    });
    const { GET,POST } = await importTestModule("src/app/api/team-workweek/private-draft/route.ts",{"server-only":{}});
    const {workweekStart} = await import("../../src/features/team-workweek/model/team-workweek-week");
    const week = workweekStart();
    const request = (index:number,payload?:unknown) => ({headers:new Headers({authorization:`Bearer ${tokens[index]}`}),nextUrl:new URL(`http://localhost:3000/api/team-workweek/private-draft?week=${week}`),json:async()=>payload}) as NextRequest;
    // Give the first owner a concrete published base; an empty snapshot can have the same hash for different owners.
    const source = (await database.query("insert into public.team_workweek_versions(owner_profile_id,effective_from) values($1,$2) returning id",[owners[0].profileId,week])).rows[0];
    await database.query("insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,status,sync_state,publication_revision,published_at,last_sync_at) values($1,$2,$3,'[]','published','confirmed',1,clock_timestamp(),clock_timestamp())",[source.id,owners[0].profileId,week]);
    const first = await GET(request(0));
    expect(first.status).toBe(200);
    const initial = await first.json();
    expect(initial.version).toBeNull();
    const payload = {selectedWeekStart:week,contextToken:initial.weekContext.contextToken,windows:{monday:[{start:"09:00",end:"12:00"}]}};
    const saved = await POST(request(0,payload));
    expect(saved.status).toBe(201);
    const created = await saved.json();
    const own = await GET(request(0));
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({version:{id:created.version.id,windows:{monday:[{start:"09:00",end:"12:00"}]}}});
    const other = await GET(request(1));
    expect(other.status).toBe(200);
    expect((await other.json()).version).toBeNull();
    // A foreign published baseline cannot be used as the second owner's edit context.
    expect((await POST(request(1,payload))).status).toBe(409);
    const {authorizeCredentialAction} = await importTestModule("src/lib/credentials/index.ts",{"server-only":{}});
    const secondOwner = await authorizeCredentialAction({credential:{kind:"session-request",request:request(1)},action:"workweek.private.read"});
    expect(secondOwner.ok).toBe(true);
    if (!secondOwner.ok) throw new Error("Expected private draft authorization");
    // These exact-ID conditional paths also keep the owner binding under real RLS.
    expect((await secondOwner.privateDraft.readSourcePublication(created.version.id)).data).toBeNull();
    expect((await secondOwner.privateDraft.readAutomaticSource(created.version.id)).data).toBeNull();
    const headers = {apikey:local.ANON_KEY,authorization:`Bearer ${tokens[0]}`};
    expect((await originalFetch(`${local.API_URL}/rest/v1/team_workweek_versions?select=id`,{headers})).status).toBe(403);
    expect((await originalFetch(`${local.API_URL}/rest/v1/team_workweek_google_conflicts?select=id`,{headers})).status).toBe(403);
    await database.query("delete from auth.sessions where id=$1",[owners[0].sessionId]);
    expect((await POST(request(0,payload))).status).toBe(403);
  } finally {
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    for (const owner of owners) {
      await database.query("delete from public.team_workweek_versions v where owner_profile_id=$1 and not exists(select 1 from public.team_workweek_publications p where p.source_version_id=v.id)",[owner.profileId]);
      await database.query("delete from public.team_workweek_publications where owner_profile_id=$1",[owner.profileId]);
      await database.query("delete from public.team_workweek_versions where owner_profile_id=$1",[owner.profileId]);
      await database.query("delete from workspace_private.identity_bindings where user_id=$1",[owner.userId]);
      await database.query("delete from workspace_private.google_login_sessions where user_id=$1",[owner.userId]);
      await database.query("delete from public.profiles where id=$1",[owner.profileId]);
      await database.query("delete from auth.users where id=$1",[owner.userId]);
    }
    await database.query("update workspace_private.configuration set mode=$1,linking_enforced=$2",[previous.mode,previous.linking_enforced]);
    await database.end();
  }
},30_000);
