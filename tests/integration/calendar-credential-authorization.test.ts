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
  try {
    await database.query("insert into auth.users(id,email,role,aud,email_confirmed_at) values ($1,'synthetic-calendar@example.test','authenticated','authenticated',now())", [userId]);
    await database.query("insert into public.profiles(id,auth_user_id,name,platform_role) values ($1,$2,'Synthetic Calendar','founder')", [profileId,userId]);
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
      return originalFetch(request);
    });
    const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
    const authorize = () => authorizeCredentialAction({ credential: { kind: "session-request", request: { headers: new Headers({ authorization: `Bearer ${token}` }) } as NextRequest }, action: "calendar.read" });
    const authorized = await authorize();
    expect(authorized).toMatchObject({ ok: true, profile: { id: profileId } });
    if (!authorized.ok) throw new Error("Expected calendar authorization");
    const reads = await Promise.all([authorized.calendar.readPublications("2026-01-01"), authorized.calendar.readPublishedOwners()]);
    expect(reads.every(result => result.error === null)).toBe(true);
    expect(membershipReads).toBe(1);
    const headers = { apikey: local.ANON_KEY, authorization: `Bearer ${token}` };
    expect((await originalFetch(`${local.API_URL}/rest/v1/team_workweek_publications?select=id`, { headers })).status).toBe(403);
    await database.query("delete from auth.sessions where id=$1", [sessionId]);
    expect(await authorize()).toMatchObject({ ok: false });
    // A capability issued before removal cannot issue a later operation permit.
    expect((await authorized.calendar.readPublishedOwners()).error).not.toBeNull();
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
