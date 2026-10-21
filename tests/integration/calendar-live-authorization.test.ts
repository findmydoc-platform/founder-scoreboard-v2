import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { createCalendarLiveFixture } from "./helpers/calendar-live-fixture";

it("real Auth and PostgREST retain Calendar roles, exact JWTs, complete histories and live revocation", async () => {
  const fixture = await createCalendarLiveFixture();
  const originalFetch = globalThis.fetch;
  let jar: NextRequest["cookies"];
  let currentToken = "", revokeAfterProfile = false;
  let attempts: string[] = [], directory = 0;
  let currentSessionId = "";
  try {
    for (const [name,value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL:fixture.local.API_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY:fixture.local.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY:fixture.local.SERVICE_ROLE_KEY,GOOGLE_WORKLOAD_IDENTITY_AUDIENCE:"synthetic-calendar-audience",
      GOOGLE_WORKSPACE_SERVICE_ACCOUNT:"synthetic-calendar@example.test",GOOGLE_AUTHORIZED_GROUP:"internal-tool-founder-ops-access@findmydoc.eu",
      VERCEL_OIDC_TOKEN:"synthetic-oidc",APP_URL:"https://application.example.test" })) vi.stubEnv(name,value);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL,init?: RequestInit) => {
      const request = new Request(input,init), url = new URL(request.url);
      if (url.hostname === "sts.googleapis.com") { directory++; return Response.json({access_token:"synthetic-sts"}); }
      if (url.hostname === "iamcredentials.googleapis.com") { directory++; return Response.json({accessToken:"synthetic-reader",expireTime:new Date(Date.now()+3600000).toISOString()}); }
      if (url.hostname === "admin.googleapis.com") { directory++; return Response.json({isMember:true}); }
      if (url.origin !== new URL(fixture.local.API_URL).origin) throw new Error("Unexpected external provider");
      attempts.push(url.pathname);
      if (["/rest/v1/rpc/current_authenticated_profile","/rest/v1/profiles","/rest/v1/team_workweek_publications"].includes(url.pathname)) {
        // Compare in memory; never print a JWT in assertion diagnostics.
        expect(request.headers.get("authorization") === `Bearer ${currentToken}`).toBe(true);
      }
      const response = await originalFetch(request);
      if (url.pathname === "/rest/v1/profiles" && revokeAfterProfile) {
        revokeAfterProfile = false;
        await fixture.database.query("delete from auth.sessions where id=$1", [currentSessionId]);
      }
      return response;
    });
    const {authorizeCredentialAction} = await importTestModule("src/lib/credentials/index.ts", {"server-only":{},"next/headers":{cookies:async()=>jar}});
    await fixture.mode("linking");
    for (const role of ["ceo","deputy","founder","viewer"]) {
      const actor = await fixture.actor(role);
      await fixture.publish(actor.profileId);
      currentToken = actor.session.access_token;
      vi.stubEnv("VERCEL_OIDC_TOKEN",currentToken);
      const read = async (cookie: boolean) => {
        const base = `sb-${new URL(fixture.local.API_URL).hostname.split(".")[0]}-auth-token`;
        const headers: Record<string,string> = cookie ? {cookie:`${base}=base64-${Buffer.from(JSON.stringify(actor.session)).toString("base64url")}`} : {authorization:`Bearer ${currentToken}`};
        const request = new NextRequest("https://application.example.test/api/team-calendar", {headers});
        if (cookie) await authorizeCredentialAction({credential:{kind:"http-request",request},action:"session.proxy"});
        jar = request.cookies;
        const authorized = await authorizeCredentialAction({credential:{kind:"session-request",request},action:"calendar.read"});
        expect(authorized).toMatchObject({ok:true,profile:{id:actor.profileId,platformRole:role}});
        if (!authorized.ok) throw new Error("Expected authorized real Calendar");
        return {authorized,snapshot:await authorized.calendar.readSnapshot("2026-10-19")};
      };
      await read(false); // Warm real JWKS and private membership evidence.
      const beforeDirectory = directory;
      attempts=[];
      const cookie = await read(true);
      expect(cookie.snapshot.error).toBeNull();
      expect(cookie.snapshot.data?.publishedOwnerIds).toContain(actor.profileId);
      expect(attempts).toHaveLength(11);
      expect(attempts.filter(path=>path==="/auth/v1/user")).toHaveLength(4);
      expect(attempts.filter(path=>path==="/rest/v1/rpc/current_authenticated_profile")).toHaveLength(1);
      expect(attempts.filter(path=>path==="/rest/v1/rpc/workspace_release_permit")).toHaveLength(2);
      expect(directory).toBe(beforeDirectory);
      attempts=[];
      expect((await read(false)).snapshot.data).toEqual(cookie.snapshot.data);
      expect(attempts).toHaveLength(10);
      expect((await fixture.database.query("select count(*)::integer as remaining from workspace_private.request_permits where user_id=$1",[actor.userId])).rows[0].remaining).toBe(0);
      const noPermit = await originalFetch(`${fixture.local.API_URL}/rest/v1/profiles?select=id`, {headers:{apikey:fixture.local.ANON_KEY,authorization:`Bearer ${currentToken}`}});
      expect(noPermit.status).toBe(403);
      const tampered = `${currentToken.slice(0,currentToken.lastIndexOf(".")+1)}${Buffer.alloc(64).toString("base64url")}`;
      expect((await originalFetch(`${fixture.local.API_URL}/rest/v1/profiles?select=id`, {headers:{apikey:fixture.local.ANON_KEY,authorization:`Bearer ${tampered}`}})).status).toBe(401);
      if (role === "viewer") {
        await fixture.database.query("delete from public.team_workweek_publications where owner_profile_id=$1", [actor.profileId]);
        await fixture.database.query("delete from public.team_workweek_versions where owner_profile_id=$1", [actor.profileId]);
        await fixture.publish(actor.profileId,101);
        attempts=[];
        const history = await read(true);
        expect(history.snapshot.data?.publications.filter((row:{owner_profile_id:string})=>row.owner_profile_id===actor.profileId)).toHaveLength(101);
        expect(attempts).toHaveLength(15);
        expect(attempts.filter(path=>path==="/rest/v1/team_workweek_publications")).toHaveLength(1);
        await fixture.database.query(`with chain as (select id,lead(id) over(order by effective_from) as successor from public.team_workweek_publications where owner_profile_id=$1)
          update public.team_workweek_publications publication set effective_to=publication.effective_from+6,superseded_by_publication_id=chain.successor from chain where publication.id=chain.id and chain.successor is not null`,[actor.profileId]);
        const range = await history.authorized.calendar.readSnapshot("2028-01-01");
        expect(range.error).toBeNull();
        expect(range.data?.publications.filter((row:{owner_profile_id:string})=>row.owner_profile_id===actor.profileId)).toHaveLength(39);
        currentSessionId=actor.sessionId; revokeAfterProfile=true;
        const interrupted = await history.authorized.calendar.readSnapshot("2026-10-19");
        expect(interrupted.data).toBeNull();
        expect(interrupted.error).toEqual({message:"Calendar snapshot is unavailable."});
        const revoked = await authorizeCredentialAction({credential:{kind:"session-request",request:new NextRequest("https://application.example.test/api/team-calendar",{headers:{authorization:`Bearer ${currentToken}`}})},action:"calendar.read"});
        expect(revoked.ok).toBe(false);
      }
    }
    for (const change of ["ban","delete","unmap"] as const) {
      const actor = await fixture.actor();
      currentToken = actor.session.access_token;
      vi.stubEnv("VERCEL_OIDC_TOKEN",currentToken);
      const request = () => new NextRequest("https://application.example.test/api/team-calendar", {headers:{authorization:`Bearer ${currentToken}`}});
      const initial = await authorizeCredentialAction({credential:{kind:"session-request",request:request()},action:"calendar.read"});
      expect(initial.ok).toBe(true);
      if (change === "ban") expect((await fixture.admin.auth.admin.updateUserById(actor.userId,{ban_duration:"1h"})).error).toBeNull();
      if (change === "delete") {
        await fixture.database.query("delete from workspace_private.identity_bindings where user_id=$1",[actor.userId]);
        await fixture.database.query("delete from workspace_private.google_login_sessions where user_id=$1",[actor.userId]);
        expect((await fixture.admin.auth.admin.deleteUser(actor.userId)).error).toBeNull();
      }
      if (change === "unmap") await fixture.database.query("update public.profiles set auth_user_id=null where id=$1",[actor.profileId]);
      const invalidated = await authorizeCredentialAction({credential:{kind:"session-request",request:request()},action:"calendar.read"});
      expect(invalidated).toMatchObject({ok:false,status:change === "unmap" ? 403 : 401});
      if (initial.ok) expect((await initial.calendar.readSnapshot("2026-10-19")).data).toBeNull();
    }
  } finally {
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    await fixture.close();
  }
}, 60_000);
