import { createCipheriv } from "node:crypto";
import { NextRequest } from "next/server";
import { expect, it, vi } from "vitest";
import { importTestModule } from "../helpers/vitest-module.mjs";
import { createCalendarLiveFixture } from "./helpers/calendar-live-fixture";

const mocks = { "server-only": {} };
const expiresAt = "2099-01-01T00:00:00.000Z";

async function withStatus(run: (fixture: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const fixture = await setup();
  try { await run(fixture); }
  finally { await fixture.close(); }
}

async function setup() {
  const live = await createCalendarLiveFixture();
  await live.mode("linking");
  const actor = await live.actor("founder");
  const nativeFetch = globalThis.fetch;
  const key = Buffer.alloc(32, 19);
  const encrypt = (value: string) => {
    const cipher = createCipheriv("aes-256-gcm", key, Buffer.alloc(12, 11));
    const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return "v1." + [Buffer.alloc(12, 11), cipher.getAuthTag(), bytes].map(part => part.toString("base64url")).join(".");
  };
  await live.database.query("insert into public.google_workspace_connections(profile_id,encrypted_access_token,encrypted_refresh_token,access_token_expires_at,refresh_token_expires_at,oauth_scopes,token_type,primary_calendar_id) values($1,$2,$3,$4,$4,$5,'Bearer','primary')", [actor.profileId, encrypt("synthetic-access"), encrypt("synthetic-refresh"), expiresAt, ["https://www.googleapis.com/auth/calendar.events.owned"]]);
  for (const [name, value] of Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: live.local.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: live.local.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: live.local.SERVICE_ROLE_KEY, REQUIRE_SUPABASE_AUTH: "true",
    GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: "synthetic-status-audience", GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "synthetic-status@example.test",
    GOOGLE_AUTHORIZED_GROUP: "internal-tool-founder-ops-access@findmydoc.eu", VERCEL_OIDC_TOKEN: actor.session.access_token,
    GOOGLE_WORKSPACE_CLIENT_ID: "synthetic-client", GOOGLE_WORKSPACE_CLIENT_SECRET: "synthetic-secret", GOOGLE_WORKSPACE_TOKEN_ENCRYPTION_KEY: key.toString("base64"),
  })) vi.stubEnv(name, value);
  const attempts: Array<{ path: string; method: string }> = [];
  let provider = async (request: Request): Promise<Response> => {
    if (new URL(request.url).pathname === "/calendar/v3/calendars/primary/events") return Response.json({ kind: "calendar#events", summary: "Synthetic primary" });
    throw new Error("Unscripted synthetic Google request");
  };
  let beforeLocal: (request: Request) => Promise<Response | void> = async () => {};
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url);
    attempts.push({ path: url.pathname, method: request.method });
    if (url.hostname === "sts.googleapis.com") return Response.json({ access_token: "synthetic-sts" });
    if (url.hostname === "iamcredentials.googleapis.com") return Response.json({ accessToken: "synthetic-directory", expireTime: expiresAt });
    if (url.hostname === "admin.googleapis.com") return Response.json({ isMember: true });
    if (url.origin === new URL(live.local.API_URL).origin) { const overridden = await beforeLocal(request); return overridden || nativeFetch(request); }
    if (url.hostname === "www.googleapis.com" || url.href === "https://oauth2.googleapis.com/token") return provider(request);
    throw new Error("Unscripted external status request");
  });
  vi.resetModules();
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", mocks);
  const { GET } = await importTestModule("src/app/api/google-workspace/status/route.ts", mocks);
  const request = () => new NextRequest("https://application.example.test/api/google-workspace/status", { headers: { authorization: `Bearer ${actor.session.access_token}` } });
  const authorize = () => authorizeCredentialAction({ credential: { kind: "session-request", request: request() }, action: "connection.google.read" });
  return { ...live, actor, createActor: live.actor, attempts, encrypt, request, authorize, authorizeCredentialAction, get: () => GET(request()),
    setProvider(value: typeof provider) { provider = value; },
    beforeLocal(value: typeof beforeLocal) { beforeLocal = value; },
    async close() { await live.database.query("delete from public.google_workspace_disconnect_operations where owner_profile_id=$1", [actor.profileId]); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules(); await live.close(); },
  };
}

it("complete Google status preserves its response and controlled HTTP budget", () => withStatus(async f => {
  const response = await f.get();
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ connection: {
    state: "connected", calendarLabel: "Synthetic primary", connectedAt: expect.any(String),
    refreshedAt: null, lastUsedAt: null, accessTokenExpiresAt: "2099-01-01T00:00:00+00:00",
  }, disconnectPending: false });
  // Direct Bearer route, real Auth/JWKS/REST and synthetic Google protocols; no cookie proxy.
  expect(f.attempts).toHaveLength(36);
  expect(f.attempts.filter(x => x.path === "/auth/v1/user")).toHaveLength(6);
  expect(f.attempts.filter(x => x.path === "/rest/v1/rpc/workspace_linking_session_allowed")).toHaveLength(2);
  expect(f.attempts.filter(x => x.path === "/rest/v1/google_workspace_connections")).toHaveLength(3);
  expect(f.attempts.filter(x => x.path === "/rest/v1/rpc/use_google_calendar_connection")).toHaveLength(1);
  expect(f.attempts.filter(x => x.path === "/calendar/v3/calendars/primary/events")).toHaveLength(1);
  f.attempts.length = 0;
  expect((await f.get()).status).toBe(200);
  expect(f.attempts).toHaveLength(32);
}), 30_000);

it.each(["ceo", "deputy", "founder", "viewer"])("%s retains Google status access", role => withStatus(async f => {
  await f.database.query("update public.profiles set platform_role=$1 where id=$2", [role, f.actor.profileId]);
  expect((await f.get()).status).toBe(200);
}), 30_000);

it("anonymous and unmapped sessions cannot read Google connection data", () => withStatus(async f => {
  const { GET } = await importTestModule("src/app/api/google-workspace/status/route.ts", mocks);
  expect((await GET(new NextRequest("https://application.example.test/api/google-workspace/status"))).status).toBe(401);
  await f.database.query("update public.profiles set auth_user_id=null where id=$1", [f.actor.profileId]);
  expect((await f.get()).status).toBe(403);
  expect(f.attempts.filter(x => x.path === "/rest/v1/google_workspace_connections" || x.path === "/rest/v1/google_workspace_disconnect_operations")).toHaveLength(0);
}), 30_000);

it.each(["session", "profile", "role", "workspace"])("held Google status rejects live %s changes before vault access or refresh", change => withStatus(async f => {
  await f.database.query("update public.google_workspace_connections set access_token_expires_at='2000-01-01' where profile_id=$1", [f.actor.profileId]);
  const held = await f.authorize();
  if (!held.ok) throw new Error("Expected admitted status resource");
  if (change === "session") await f.database.query("delete from auth.sessions where id=$1", [f.actor.sessionId]);
  if (change === "profile") await f.database.query("update public.profiles set auth_user_id=null where id=$1", [f.actor.profileId]);
  if (change === "role") await f.database.query("update public.profiles set platform_role='viewer' where id=$1", [f.actor.profileId]);
  if (change === "workspace") await f.mode("google");
  f.attempts.length = 0;
  await expect(held.resource.readGoogleConnection()).rejects.toThrow();
  expect(f.attempts.filter(x => x.path === "/rest/v1/google_workspace_connections" || x.path === "/token" || x.path === "/rest/v1/rpc/claim_google_calendar_refresh")).toHaveLength(0);
}), 30_000);

it("a held status cannot follow the session to a different mapped owner", () => withStatus(async f => {
  const other = await f.createActor("founder");
  const held = await f.authorize();
  if (!held.ok) throw new Error("Expected admitted status resource");
  await f.database.query("update public.profiles set auth_user_id=null where id=any($1)", [[f.actor.profileId, other.profileId]]);
  await f.database.query("update public.profiles set auth_user_id=$1 where id=$2", [f.actor.userId, other.profileId]);
  f.attempts.length = 0;
  await expect(held.resource.readGoogleConnection()).rejects.toThrow();
  expect(f.attempts.filter(x => x.path === "/rest/v1/google_workspace_connections")).toHaveLength(0);
}), 30_000);

it.each(["session", "owner"])("the live %s check immediately before Google access cannot be replaced by the earlier admission", change => withStatus(async f => {
  const other = await f.createActor("founder");
  let consumed = false;
  f.beforeLocal(async request => {
    if (!consumed && new URL(request.url).pathname === "/rest/v1/rpc/use_google_calendar_connection") {
      consumed = true;
      if (change === "session") await f.database.query("delete from auth.sessions where id=$1", [f.actor.sessionId]);
      else {
        await f.database.query("update public.profiles set auth_user_id=null where id=any($1)", [[f.actor.profileId, other.profileId]]);
        await f.database.query("update public.profiles set auth_user_id=$1 where id=$2", [f.actor.userId, other.profileId]);
      }
    }
  });
  const response = await f.get();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ connection: { state: "connected", calendarLabel: null } });
  expect(consumed).toBe(true);
  expect(f.attempts.filter(x => x.path === "/calendar/v3/calendars/primary/events")).toHaveLength(0);
}), 30_000);

it.each(["connection", "token"])("a %s replacement during status acquisition cannot dispatch the stale token", change => withStatus(async f => {
  let replaced = false;
  f.beforeLocal(async request => {
    if (!replaced && new URL(request.url).pathname === "/rest/v1/rpc/use_google_calendar_connection") {
      replaced = true;
      await f.database.query(change === "connection"
        ? "update public.google_workspace_connections set connection_id=gen_random_uuid() where profile_id=$1"
        : "update public.google_workspace_connections set credential_version=credential_version+1,encrypted_access_token=$2 where profile_id=$1",
        change === "connection" ? [f.actor.profileId] : [f.actor.profileId, f.encrypt("synthetic-replacement")]);
    }
  });
  expect(await (await f.get()).json()).toMatchObject({ connection: { state: "connected", calendarLabel: null } });
  expect(f.attempts.filter(x => x.path === "/calendar/v3/calendars/primary/events")).toHaveLength(0);
}), 30_000);

it.each(["missing", "revoked"])("%s connections keep their disconnected status without provider access", state => withStatus(async f => {
  await f.database.query(state === "missing" ? "delete from public.google_workspace_connections where profile_id=$1" : "update public.google_workspace_connections set revoked_at=now() where profile_id=$1", [f.actor.profileId]);
  const response = await f.get();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ connection: { state: state === "missing" ? "not_connected" : "reconnect_required" }, disconnectPending: false });
  expect(f.attempts.filter(x => x.path === "/token" || x.path === "/calendar/v3/calendars/primary/events" || x.path === "/rest/v1/rpc/use_google_calendar_connection")).toHaveLength(0);
}), 30_000);

it("status preserves pending disconnect ownership and unavailable cleanup errors", () => withStatus(async f => {
  const other = await f.createActor("founder");
  const insert = (profileId: string, state: string) => f.database.query("insert into public.google_workspace_disconnect_operations(owner_profile_id,requested_by,revoke_connection,cutoff_date,state,deactivated_at) values($1,'owner',true,current_date,$2,null)", [profileId, state]);
  try {
    await insert(other.profileId, "cleaning");
    expect(await (await f.get()).json()).toMatchObject({ disconnectPending: false });
    await insert(f.actor.profileId, "cleaning");
    expect(await (await f.get()).json()).toMatchObject({ disconnectPending: true });
    f.beforeLocal(async request => new URL(request.url).pathname === "/rest/v1/google_workspace_disconnect_operations" ? Response.json({ message: "Synthetic cleanup unavailable" }, { status: 500 }) : undefined);
    const failed = await f.get();
    expect(failed.status).toBe(503);
    expect(await failed.json()).toEqual({ error: "Google-Verbindungsstatus ist nicht verfügbar." });
  } finally { await f.database.query("delete from public.google_workspace_disconnect_operations where owner_profile_id=$1", [other.profileId]); }
}), 30_000);

it("status refresh keeps rotation, encrypted storage, usage and its original response snapshot", () => withStatus(async f => {
  await f.database.query("update public.google_workspace_connections set access_token_expires_at='2000-01-01' where profile_id=$1", [f.actor.profileId]);
  f.setProvider(async request => {
    if (new URL(request.url).pathname === "/token") return Response.json({ access_token: "synthetic-rotated", refresh_token: "synthetic-rotated-refresh", expires_in: 3600, refresh_token_expires_in: 7200, token_type: "Bearer" });
    expect(request.headers.get("authorization")).toBe("Bearer synthetic-rotated");
    return Response.json({ kind: "calendar#events", summary: "Synthetic primary" });
  });
  const response = await f.get();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ connection: { state: "connected", calendarLabel: "Synthetic primary", accessTokenExpiresAt: "2000-01-01T00:00:00+00:00", lastUsedAt: null } });
  const row = (await f.database.query("select * from public.google_workspace_connections where profile_id=$1", [f.actor.profileId])).rows[0];
  expect(Number(row.credential_version)).toBe(1);
  expect(row.refresh_claim_id).toBeNull();
  expect(row.last_used_at).not.toBeNull();
  expect(row.encrypted_access_token).not.toContain("synthetic-rotated");
  expect(f.attempts.filter(x => x.path === "/token")).toHaveLength(1);
}), 30_000);

it.each(["rejected", "unavailable", "uncertain"])("%s refresh preserves status fallback without replaying the token exchange", outcome => withStatus(async f => {
  await f.database.query("update public.google_workspace_connections set access_token_expires_at='2000-01-01' where profile_id=$1", [f.actor.profileId]);
  let refreshes = 0;
  f.setProvider(async () => {
    refreshes++;
    if (outcome === "uncertain") throw new Error("Synthetic consumed refresh response lost");
    return Response.json({ error: outcome === "rejected" ? "invalid_grant" : "server_error" }, { status: outcome === "rejected" ? 400 : 503 });
  });
  const response = await f.get();
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ connection: { state: "connected", calendarLabel: null } });
  expect((await f.get()).status).toBe(200);
  expect(refreshes).toBe(1);
  expect(f.attempts.filter(x => x.path === "/calendar/v3/calendars/primary/events")).toHaveLength(0);
}), 30_000);

it("a newer connection during refresh cannot be overwritten or probed with stale credentials", () => withStatus(async f => {
  await f.database.query("update public.google_workspace_connections set access_token_expires_at='2000-01-01' where profile_id=$1", [f.actor.profileId]);
  f.setProvider(async request => {
    expect(new URL(request.url).pathname).toBe("/token");
    const current = (await f.database.query("select connection_id,credential_version from public.google_workspace_connections where profile_id=$1", [f.actor.profileId])).rows[0];
    const replaced = await f.database.query("select public.store_google_calendar_connection($1,$2,$3,$4,$4,$5,$6) as stored", [f.actor.profileId, f.encrypt("synthetic-replacement"), f.encrypt("synthetic-replacement-refresh"), expiresAt, current.connection_id, current.credential_version]);
    expect(replaced.rows[0].stored).toBe(true);
    return Response.json({ access_token: "synthetic-stale", refresh_token: "synthetic-stale-refresh", expires_in: 3600, token_type: "Bearer" });
  });
  expect(await (await f.get()).json()).toMatchObject({ connection: { state: "connected", calendarLabel: null } });
  expect(f.attempts.filter(x => x.path === "/calendar/v3/calendars/primary/events")).toHaveLength(0);
  const row = (await f.database.query("select credential_version,last_error_class from public.google_workspace_connections where profile_id=$1", [f.actor.profileId])).rows[0];
  expect(Number(row.credential_version)).toBe(1);
  expect(row.last_error_class).toBeNull();
}), 30_000);

it.each(["configuration", "refresh-deadline"])("status preserves the %s guard before provider access", change => withStatus(async f => {
  if (change === "refresh-deadline") await f.database.query("update public.google_workspace_connections set refresh_token_expires_at='2000-01-01' where profile_id=$1", [f.actor.profileId]);
  if (change === "configuration") vi.stubEnv("GOOGLE_WORKSPACE_CLIENT_SECRET", "");
  const response = await f.get();
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.connection.state).toBe(change === "refresh-deadline" ? "reconnect_required" : "connected");
  if (change !== "refresh-deadline") expect(body.connection.calendarLabel).toBeNull();
  expect(f.attempts.filter(x => x.path === "/token" || x.path === "/calendar/v3/calendars/primary/events")).toHaveLength(0);
}), 30_000);

it("a refreshed token with broader scopes cannot reach the Calendar probe", () => withStatus(async f => {
  await f.database.query("update public.google_workspace_connections set access_token_expires_at='2000-01-01' where profile_id=$1", [f.actor.profileId]);
  f.setProvider(async () => Response.json({ access_token: "synthetic-broader", expires_in: 3600, token_type: "Bearer", scope: "https://www.googleapis.com/auth/calendar" }));
  expect(await (await f.get()).json()).toMatchObject({ connection: { state: "connected", calendarLabel: null } });
  expect(f.attempts.filter(x => x.path === "/calendar/v3/calendars/primary/events")).toHaveLength(0);
  expect((await f.database.query("select last_error_class from public.google_workspace_connections where profile_id=$1", [f.actor.profileId])).rows[0].last_error_class).toBe("oauth_scope_mismatch");
}), 30_000);

it("a held status retains the original membership evidence deadline before vault access", () => withStatus(async f => {
  const held = await f.authorize();
  if (!held.ok) throw new Error("Expected admitted status resource");
  f.attempts.length = 0;
  const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 901_000);
  try { await expect(held.resource.readGoogleConnection()).rejects.toThrow(); }
  finally { clock.mockRestore(); }
  expect(f.attempts.filter(x => x.path === "/rest/v1/google_workspace_connections")).toHaveLength(0);
}), 30_000);
