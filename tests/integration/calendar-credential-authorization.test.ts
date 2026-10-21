import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import pg from "pg";
import { expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import { importTestModule } from "../helpers/vitest-module.mjs";

it("calendar authorization retains PostgREST JWT, individual permit and session enforcement", async () => {
  const { stdout } = await promisify(execFile)(resolve("node_modules/.bin/supabase"), ["status", "-o", "json"]);
  const local = JSON.parse(stdout);
  if (!new Set(["localhost", "127.0.0.1"]).has(new URL(local.API_URL).hostname)) throw new Error("Local test target required");
  const database = new pg.Client(local.DB_URL);
  await database.connect();
  const userId = randomUUID(), sessionId = randomUUID(), subject = randomUUID(), profileId = `calendar-${randomUUID()}`;
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const now = Math.floor(Date.now()/1000);
  const unsigned = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ iss: `${local.API_URL}/auth/v1`, sub: userId,
    aud: "authenticated", role: "authenticated", session_id: sessionId, iat: now, exp: now+3600, amr: [{ method: "oauth", timestamp: now }] })}`;
  const token = `${unsigned}.${createHmac("sha256", local.JWT_SECRET).update(unsigned).digest("base64url")}`;
  const originalFetch = globalThis.fetch;
  const previous = (await database.query("select mode,linking_enforced from workspace_private.configuration")).rows[0];
  let membershipReads = 0;
  let revokeAfterProfileRead = false;
  const dataPaths: string[] = [];
  const permitPaths: string[] = [];
  try {
    await database.query("insert into auth.users(id,email,role,aud,email_confirmed_at) values ($1,'synthetic-calendar@example.test','authenticated','authenticated',now())", [userId]);
    await database.query("insert into public.profiles(id,auth_user_id,name,platform_role) values ($1,$2,'Synthetic Calendar','founder')", [profileId,userId]);
    const effectiveFrom = (await database.query("select date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date as value")).rows[0].value.toISOString().slice(0, 10);
    const sourceVersionId = (await database.query("insert into public.team_workweek_versions(owner_profile_id,effective_from) values($1,$2) returning id", [profileId,effectiveFrom])).rows[0].id;
    const publicationId = (await database.query(`insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,status,sync_state,published_at,last_sync_at)
      values($1,$2,$3,'[]','published','confirmed',clock_timestamp(),clock_timestamp()) returning id`, [sourceVersionId,profileId,effectiveFrom])).rows[0].id;
    await database.query(`with weeks as (
        select start.week_start + (7 * series.weeks_ahead) as effective_from
        from (select date_trunc('week',clock_timestamp() at time zone 'Europe/Berlin')::date as week_start) as start
        cross join generate_series(1,100) as series(weeks_ahead)
      ), versions as (
        insert into public.team_workweek_versions(owner_profile_id,effective_from)
        select $1,effective_from from weeks returning id,owner_profile_id,effective_from
      )
      insert into public.team_workweek_publications(source_version_id,owner_profile_id,effective_from,windows,status,sync_state,publication_revision,published_at,last_sync_at)
      select id,owner_profile_id,effective_from,'[]','published','confirmed',row_number() over(order by effective_from)::integer + 1,clock_timestamp(),clock_timestamp()
      from versions`, [profileId]);
    await database.query("insert into auth.identities(user_id,provider,provider_id,identity_data) values ($1,'google',$2,$3)", [userId,subject,JSON.stringify({ sub: subject, iss: "https://accounts.google.com", email: "synthetic-calendar@findmydoc.eu", email_verified: true, custom_claims: { hd: "findmydoc.eu" } })]);
    await database.query("insert into workspace_private.identity_bindings(user_id,google_subject) values ($1,$2)", [userId,subject]);
    await database.query("insert into auth.sessions(id,user_id,created_at) values ($1,$2,now())", [sessionId,userId]);
    await database.query("update workspace_private.configuration set mode='linking',linking_enforced=true");
    await database.query("select public.workspace_record_google_login($1,$2,$3)", [userId,sessionId,subject]);
    for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: local.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: local.ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: local.SERVICE_ROLE_KEY, GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: "synthetic-calendar-audience",
      GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "synthetic-calendar@example.test", GOOGLE_AUTHORIZED_GROUP: "internal-tool-founder-ops-access@findmydoc.eu", VERCEL_OIDC_TOKEN: token })) vi.stubEnv(name, value);
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init); const url = new URL(request.url);
      // Auth is the controlled external protocol; PostgREST still verifies this exact signed JWT itself.
      if (url.pathname === "/auth/v1/user") {
        return request.headers.get("authorization") === `Bearer ${token}`
          ? Response.json({ id: userId, aud: "authenticated", role: "authenticated", identities: [] })
          : Response.json({ message: "Invalid credential" }, { status: 401 });
      }
      if (url.hostname === "sts.googleapis.com") return Response.json({ access_token: "synthetic-sts" });
      if (url.hostname === "iamcredentials.googleapis.com") return Response.json({ accessToken: "synthetic-reader", expireTime: new Date(Date.now()+3600000).toISOString() });
      if (url.hostname === "admin.googleapis.com") { membershipReads++; return Response.json({ isMember: true }); }
      if (url.origin !== new URL(local.API_URL).origin) throw new Error("Unexpected external provider in calendar test");
      if (url.pathname === "/rest/v1/rpc/workspace_calendar_prepare") permitPaths.push((await request.clone().json()).p_path);
      if (["/rest/v1/profiles", "/rest/v1/team_workweek_publications"].includes(url.pathname)) dataPaths.push(url.pathname);
      const response = await originalFetch(request);
      if (url.pathname === "/rest/v1/profiles" && revokeAfterProfileRead) {
        revokeAfterProfileRead = false;
        await database.query("delete from auth.sessions where id=$1", [sessionId]);
      }
      return response;
    });
    const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
    const authorize = () => authorizeCredentialAction({ credential: { kind: "session-request", request: { headers: new Headers({ authorization: `Bearer ${token}` }) } as NextRequest }, action: "calendar.read" });
    const authorized = await authorize();
    expect(authorized).toMatchObject({ ok: true, profile: { id: profileId } });
    if (!authorized.ok) throw new Error("Expected calendar authorization");
    const snapshot = await authorized.calendar.readSnapshot(effectiveFrom);
    expect(snapshot.error).toBeNull();
    expect(snapshot.data?.publishedOwnerIds).toContain(profileId);
    expect(snapshot.data?.publications).toHaveLength(101);
    expect(snapshot.data!.publications[0].effective_from > snapshot.data!.publications.at(-1)!.effective_from).toBe(true);
    expect(snapshot.data?.publications.at(-1)?.id).toBe(publicationId);
    expect(dataPaths).toEqual(["/rest/v1/profiles", "/rest/v1/team_workweek_publications"]);
    expect(permitPaths.filter(path => path === "/profiles")).toHaveLength(1);
    expect(permitPaths.filter(path => path === "/team_workweek_publications")).toHaveLength(1);
    expect(membershipReads).toBe(1);
    const headers = { apikey: local.ANON_KEY, authorization: `Bearer ${token}` };
    expect((await originalFetch(`${local.API_URL}/rest/v1/team_workweek_publications?select=id`, { headers })).status).toBe(403);
    expect((await originalFetch(`${local.API_URL}/rest/v1/profiles?select=id`, { headers })).status).toBe(403);
    revokeAfterProfileRead = true;
    const interrupted = await authorized.calendar.readSnapshot(effectiveFrom);
    expect(interrupted.data).toBeNull();
    expect(interrupted.error).not.toBeNull();
    expect(dataPaths.slice(-1)).toEqual(["/rest/v1/profiles"]);
    expect(await authorize()).toMatchObject({ ok: false });
    // Every continuation request revalidates the session and cannot expose a partial snapshot.
    expect(membershipReads).toBe(1);
  } finally {
    vi.unstubAllGlobals(); vi.unstubAllEnvs();
    await database.query("delete from workspace_private.identity_bindings where user_id=$1", [userId]);
    await database.query("delete from workspace_private.google_login_sessions where user_id=$1", [userId]);
    await database.query("delete from public.profiles where id=$1", [profileId]);
    await database.query("delete from auth.users where id=$1", [userId]);
    await database.query("update workspace_private.configuration set mode=$1,linking_enforced=$2", [previous.mode,previous.linking_enforced]);
    await database.end();
  }
}, 30_000);
