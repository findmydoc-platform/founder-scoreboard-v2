import { beforeEach, afterEach, test, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHmac } from "node:crypto";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const authOrigin = "https://session-auth.example.test";
const appOrigin = "https://application.example.test";
const cookieBase = "sb-session-auth-auth-token";
let jar, activeJar, refreshes, network;
function jwt(userId = "user-1", expires = Math.floor(Date.now()/1000)+3600) {
  const part = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${part({ alg: "HS256", typ: "JWT" })}.${part({ sub: userId, exp: expires, iat: Math.floor(Date.now()/1000), aud: "authenticated", role: "authenticated", amr: [{ method: "oauth" }], iss: `${authOrigin}/auth/v1`, session_id: "b1111111-1111-4111-8111-111111111111" })}`;
  return `${body}.${createHmac("sha256", "synthetic-signing-key").update(body).digest("base64url")}`;
}
function session(expired = false, userId = "user-1") {
  const expires = Math.floor(Date.now()/1000)+(expired ? -60 : 3600);
  return { access_token: jwt(userId, expires), refresh_token: `refresh-${userId}`, expires_at: expires, expires_in: 3600,
    token_type: "bearer", user: { id: userId, aud: "authenticated", user_metadata: {} } };
}
function encode(value) { return `base64-${Buffer.from(JSON.stringify(value)).toString("base64url")}`; }
function request(path, init = {}) {
  return new NextRequest(`${appOrigin}${path}`, { ...init, headers: { cookie: jar.getAll().map(cookie => `${cookie.name}=${cookie.value}`).join("; "), ...init.headers } });
}
async function publicModule() { return importTestModule("src/lib/credentials/index.ts", { "server-only": {}, "next/headers": { cookies: async () => activeJar || jar } }); }

beforeEach(() => {
  vi.resetModules(); refreshes = 0; activeJar = null;
  const values = new Map();
  jar = { getAll: () => [...values].map(([name, value]) => ({ name, value })), get: name => values.has(name) ? { value: values.get(name) } : undefined,
    set: (name, value) => values.set(name, value), delete: name => values.delete(name) };
  for (const [name, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: authOrigin, SUPABASE_URL: authOrigin,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon", NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-anon", SUPABASE_ANON_KEY: "synthetic-anon",
    SUPABASE_PUBLISHABLE_KEY: "synthetic-anon", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service", SUPABASE_SECRET_KEY: "synthetic-service", APP_URL: appOrigin, VERCEL_ENV: "preview" })) vi.stubEnv(name, value);
  network = async (input, init) => {
    const req = new Request(input, init); const url = new URL(req.url);
    if (url.origin !== authOrigin) throw new Error("Unexpected provider");
    if (url.pathname === "/auth/v1/token") { refreshes++; return Response.json(session()); }
    if (url.pathname === "/auth/v1/user") {
      const claims = JSON.parse(Buffer.from(req.headers.get("authorization").slice(7).split(".")[1], "base64url"));
      return Response.json({ id: claims.sub, aud: "authenticated", user_metadata: {} });
    }
    if (url.pathname.endsWith("/rpc/workspace_access_context")) return Response.json({ mode: "legacy", linkingEnforced: false, userId: "user-1", profileId: "profile-1", linked: false, identity: null });
    if (url.pathname.endsWith("/rpc/current_authenticated_profile")) return Response.json({ id: "profile-1", name: "Founder", platform_role: "founder" });
    if (url.pathname.endsWith("/rpc/administrator_access_snapshot")) return Response.json({ eligible: false, active: false });
    if (url.pathname === "/rest/v1/profile_ui_preferences") return Response.json({ default_workspace: "profile" });
    if (url.pathname === "/auth/v1/logout") return new Response(null, { status: 204 });
    throw new Error(`Unexpected protocol ${url.pathname}`);
  };
  vi.stubGlobal("fetch", (...args) => network(...args));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

test("Proxy propagates refreshed cookies to the downstream request and actual returned response", async () => {
  jar.set(cookieBase, encode(session(true)));
  const incoming = request("/planning");
  const { authorizeCredentialAction } = await publicModule();
  const response = await authorizeCredentialAction({ credential: { kind: "http-request", request: incoming }, action: "session.proxy" });
  expect(response.status).toBe(200);
  expect(refreshes).toBe(1);
  expect(response.headers.get("cache-control")).toContain("no-store");
  const active = "legacy".padEnd(32, "0");
  expect(response.cookies.get(`${cookieBase}-active`)).toBeUndefined();
  expect(response.cookies.get(`${cookieBase}-g-${active}`)?.httpOnly).toBe(true);
  expect(incoming.cookies.get(`${cookieBase}-g-${active}`)?.value).toBe(response.cookies.get(`${cookieBase}-g-${active}`)?.value);
  expect(response.headers.get("x-middleware-request-cookie")).toContain(`${cookieBase}-g-${active}=`);
});

function applyCookies(response) {
  for (const cookie of response.cookies?.getAll() || []) {
    if (cookie.maxAge === 0 || (cookie.expires && cookie.expires < new Date())) jar.delete(cookie.name);
    else jar.set(cookie.name, cookie.value);
  }
}
async function invoke(action, init = {}, path = "/api/auth/session") {
  const incoming = request(path, init); activeJar = incoming.cookies;
  const { authorizeCredentialAction } = await publicModule();
  return authorizeCredentialAction({ credential: { kind: "http-request", request: incoming }, action });
}

test("server session view contains verified identity and an opaque revision without credentials", async () => {
  jar.set(cookieBase, encode(session()));
  const response = await invoke("session.current");
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.session.userId).toBe("user-1");
  expect(body.session.revision).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(body)).not.toMatch(/access_token|refresh_token|provider_token|refresh-user/);
  expect(response.headers.get("cache-control")).toContain("no-store");
});

test("cookie mutations reject missing origin, cross-site origin and non-JSON before refresh", async () => {
  jar.set(cookieBase, encode(session()));
  for (const headers of [{}, { origin: "https://another.example.test", "content-type": "application/json" },
    { origin: appOrigin, "content-type": "application/json", "sec-fetch-site": "cross-site" }]) {
    expect((await invoke("session.recover", { method: "POST", headers, body: "{}" })).status).toBe(403);
  }
  expect((await invoke("session.recover", { method: "POST", headers: { origin: appOrigin }, body: "{}" })).status).toBe(400);
  expect((await invoke("session.recover", { method: "POST", headers: { origin: appOrigin, "content-type": "application/json-evil" }, body: "{}" })).status).toBe(400);
  expect(refreshes).toBe(0);
});

test("SSR uses the shared verified context and returns only the mapped profile workspace", async () => {
  jar.set(cookieBase, encode(session()));
  const { authorizeCredentialAction } = await publicModule();
  const auth = await authorizeCredentialAction({ credential: { kind: "server-cookies" }, action: "session.planning" });
  expect(auth).toMatchObject({ ok: true, user: { id: "user-1" }, profile: { id: "profile-1" } });
  expect(await authorizeCredentialAction({ credential: { kind: "server-cookies" }, action: "session.home" })).toBe("profile");
});

test("SSR home denies unmapped authorization without reading another profile preference", async () => {
  jar.set(cookieBase, encode(session()));
  const previous = network; let preferences = 0;
  network = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.endsWith("/rpc/current_authenticated_profile")) return Response.json({ message: "unmapped profile" }, { status: 403 });
    if (url.pathname === "/rest/v1/profile_ui_preferences") preferences++;
    return previous(input, init);
  };
  const { authorizeCredentialAction } = await publicModule();
  expect(await authorizeCredentialAction({ credential: { kind: "server-cookies" }, action: "session.home" })).toBe("planning");
  expect(preferences).toBe(0);
});

async function admitted() {
  jar.set(cookieBase, encode(session()));
  const response = await invoke("session.current"); applyCookies(response);
  return (await response.json()).session;
}
const mutation = expected => ({ method: "POST", headers: { origin: appOrigin, "content-type": "application/json" }, body: JSON.stringify({ expected }) });

test("a permanently rejected access token can still clear only its expected local cookie generation", async () => {
  const expected = await admitted(); const previous = network;
  network = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/auth/v1/user" || url.pathname === "/auth/v1/logout") return Response.json({ code: "bad_jwt", message: "Synthetic permanent rejection" }, { status: 401 });
    return previous(input, init);
  };
  const response = await invoke("session.clear", mutation(expected));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ outcome: "cleared", session: null });
  applyCookies(response);
  expect((await invoke("session.current")).status).toBe(401);
  expect(refreshes).toBe(0);
});

test("recovery can replace a permanently rejected access token only after refreshing and verifying its bound actor", async () => {
  const expected = await admitted(); const previous = network; let first = true;
  network = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/auth/v1/user" && first) { first = false; return Response.json({ code: "bad_jwt", message: "Synthetic old token rejected" }, { status: 401 }); }
    return previous(input, init);
  };
  const response = await invoke("session.recover", mutation(expected));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ outcome: "refreshed", session: { userId: expected.userId } });
  expect(refreshes).toBe(1);
});

test.each(["session.clear", "session.recover"])("%s cannot use permanent Auth denial to mutate another actor or revision", async action => {
  const expected = await admitted(); const previous = network; let logouts = 0;
  network = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/auth/v1/user") return Response.json({ code: "bad_jwt", message: "Synthetic permanent rejection" }, { status: 401 });
    if (url.pathname === "/auth/v1/logout") logouts++;
    return previous(input, init);
  };
  for (const stale of [{ ...expected, userId: "replacement-user" }, { ...expected, revision: "obsolete" }]) {
    const response = await invoke(action, mutation(stale)); applyCookies(response);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ outcome: "superseded", session: null });
  }
  expect(refreshes).toBe(0); expect(logouts).toBe(0);
  network = previous;
  expect((await invoke("session.current")).status).toBe(200);
});

test("temporary Auth failure cannot locally revoke an otherwise current cookie", async () => {
  const expected = await admitted(); const previous = network;
  network = async () => Response.json({ message: "Synthetic outage" }, { status: 503 });
  const response = await invoke("session.clear", mutation(expected)); applyCookies(response);
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ outcome: "temporarily_unavailable", session: null });
  network = previous;
  expect((await invoke("session.current")).status).toBe(200);
});

test("recovery after permanent denial cannot admit a different refreshed actor", async () => {
  const expected = await admitted(); const previous = network; let first = true;
  network = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/auth/v1/user" && first) { first = false; return Response.json({ code: "bad_jwt", message: "Synthetic old token rejected" }, { status: 401 }); }
    if (url.pathname === "/auth/v1/token") return Response.json(session(false, "replacement-user"));
    return previous(input, init);
  };
  const response = await invoke("session.recover", mutation(expected)); applyCookies(response);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ outcome: "superseded", session: null });
  expect((await invoke("session.current")).status).toBe(401);
});

test("recovery binds the verified user and revision, and keeps temporary failures distinct", async () => {
  const expected = await admitted();
  const previous = network;
  network = async (input, init) => new URL(input instanceof Request ? input.url : String(input)).pathname === "/auth/v1/user"
    ? Response.json({ msg: "Temporarily unavailable" }, { status: 503 }) : previous(input, init);
  const unavailable = await invoke("session.recover", mutation(expected));
  expect(unavailable.status).toBe(503);
  expect(await unavailable.json()).toMatchObject({ outcome: "temporarily_unavailable" });
  network = previous;
  const stale = await invoke("session.recover", mutation({ ...expected, revision: "obsolete" }));
  expect(await stale.json()).toMatchObject({ outcome: "superseded", session: { userId: "user-1" } });
  expect(refreshes).toBe(0);
  const refreshed = await invoke("session.recover", mutation(expected));
  expect(refreshed.status).toBe(200);
  expect(await refreshed.json()).toMatchObject({ outcome: "refreshed", session: { userId: "user-1" } });
  expect(refreshes).toBe(1);
});

test.each([["session.logout", "global"], ["session.clear", "local"]])("%s preserves its supported scope and invalidates the cookie generation", async (action, scope) => {
  const expected = await admitted(); const previous = network; let seen;
  network = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/auth/v1/logout") seen = url.searchParams.get("scope");
    return previous(input, init);
  };
  const response = await invoke(action, mutation(expected)); applyCookies(response);
  expect(seen).toBe(scope);
  expect(await response.json()).toMatchObject({ outcome: "cleared", session: null });
  expect((await invoke("session.current")).status).toBe(401);
});

test("a late refresh cannot reactivate a generation cleared by another request", async () => {
  const expected = await admitted(); const previous = network;
  let release, entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const delayed = new Promise(resolve => { release = resolve; });
  network = async (input, init) => {
    if (new URL(input instanceof Request ? input.url : String(input)).pathname === "/auth/v1/token") { entered(); await delayed; }
    return previous(input, init);
  };
  const recovering = invoke("session.recover", mutation(expected)); await ready;
  applyCookies(await invoke("session.clear", mutation(expected)));
  release(); const late = await recovering; applyCookies(late);
  expect(late.cookies.get(`${cookieBase}-active`)).toBeUndefined();
  expect((await invoke("session.current")).status).toBe(401);
});

test("refresh replaces chunked storage without retaining a previous session chunk", async () => {
  const large = session(true); large.user.user_metadata.padding = "x".repeat(7000);
  const encoded = encode(large);
  jar.set(`${cookieBase}.0`, encoded.slice(0, 3500)); jar.set(`${cookieBase}.1`, encoded.slice(3500));
  const incoming = request("/planning");
  const { authorizeCredentialAction } = await publicModule();
  const response = await authorizeCredentialAction({ credential: { kind: "http-request", request: incoming }, action: "session.proxy" }); applyCookies(response);
  expect(refreshes).toBe(1);
  const active = "legacy".padEnd(32, "0");
  expect(jar.get(`${cookieBase}-g-${active}`)).toBeDefined();
  expect(jar.get(`${cookieBase}-g-${active}.0`)).toBeUndefined();
  expect(jar.get(`${cookieBase}-g-${active}.1`)).toBeUndefined();
});

async function googleFlow({ providerSubject = "google-subject", providerStatus = 200, member = true, admitted = true, recordingFails = false, nonceChanged = false } = {}) {
  const calls = []; let exchanges = 0; let recorded = false;
  const identity = { sub: "google-subject", iss: "https://accounts.google.com", email: "member@findmydoc.eu", email_verified: true, custom_claims: { hd: "findmydoc.eu" } };
  for (const [name, value] of Object.entries({ VERCEL_OIDC_TOKEN: jwt(), GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: "synthetic-audience",
    GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "reader@example.test", GOOGLE_AUTHORIZED_GROUP: "internal-tool-founder-ops-access@findmydoc.eu" })) vi.stubEnv(name, value);
  const previous = network;
  network = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    calls.push(url.pathname);
    if (url.pathname === "/auth/v1/token") {
      exchanges++;
      const body = JSON.parse(await new Request(input, init).text());
      expect(body.auth_code).toBe("synthetic-authorization-code");
      expect(body.code_verifier).toBeTypeOf("string");
      return Response.json({ ...session(), provider_token: "synthetic-google-provider-proof" });
    }
    if (url.pathname.endsWith("/rpc/workspace_access_context")) return Response.json({ mode: "linking", linkingEnforced: true, linked: true, userId: "user-1", profileId: "profile-1", identity });
    if (url.hostname === "sts.googleapis.com") return Response.json({ access_token: "synthetic-exchange" });
    if (url.hostname === "iamcredentials.googleapis.com") return Response.json({ accessToken: "synthetic-directory", expireTime: new Date(Date.now()+3600000).toISOString() });
    if (url.hostname === "admin.googleapis.com") return Response.json({ isMember: member });
    if (url.hostname === "openidconnect.googleapis.com") {
      expect(recorded).toBe(false);
      expect(new Request(input, init).headers.get("authorization")).toBe("Bearer synthetic-google-provider-proof");
      return Response.json({ sub: providerSubject, email: identity.email, email_verified: true, hd: "findmydoc.eu" }, { status: providerStatus });
    }
    if (url.pathname.endsWith("/rpc/workspace_record_google_login")) {
      expect(calls).toContain("/v1/userinfo"); recorded = true;
      return recordingFails ? Response.json({ message: "Recording unavailable" }, { status: 503 }) : Response.json(null);
    }
    if (url.pathname.endsWith("/rpc/workspace_linking_session_allowed")) { expect(recorded).toBe(true); return Response.json(admitted); }
    return previous(input, init);
  };
  const login = await invoke("session.login", {}, "/auth/login?next=%2Fplanning"); applyCookies(login);
  expect(new URL(login.headers.get("location")).searchParams.get("provider")).toBe("google");
  const nonce = jar.get("workspace_google_login").value;
  const callback = await invoke("session.callback", {}, `/auth/callback?code=synthetic-authorization-code&login=${nonceChanged ? "older-nonce" : nonce}&next=%2Fplanning`);
  return { callback, calls, exchanges, recorded };
}

test("real Google callback verifies provider identity before recording and rechecks admission after the write", async () => {
  const { callback, calls, recorded } = await googleFlow();
  expect(new URL(callback.headers.get("location")).pathname).toBe("/planning");
  expect(recorded).toBe(true);
  expect(calls.indexOf("/v1/userinfo")).toBeLessThan(calls.indexOf("/rest/v1/rpc/workspace_record_google_login"));
  expect(calls.indexOf("/rest/v1/rpc/workspace_record_google_login")).toBeLessThan(calls.indexOf("/rest/v1/rpc/workspace_linking_session_allowed"));
  expect(callback.cookies.get(`${cookieBase}-active`)).toBeUndefined();
  const active = jar.get(`${cookieBase}-active`).value;
  const stored = callback.cookies.get(`${cookieBase}-g-${active}`).value;
  expect(JSON.parse(Buffer.from(stored.slice(7), "base64url"))).not.toHaveProperty("provider_token");
});

test.each([
  ["wrong provider identity", { providerSubject: "another-google-account" }],
  ["provider outage", { providerStatus: 503 }],
  ["removed group membership", { member: false }],
  ["recording outage", { recordingFails: true }],
  ["session denied after recording", { admitted: false }],
])("real Google callback denies %s and does not return an application session", async (_label, change) => {
  const { callback } = await googleFlow(change);
  expect(new URL(callback.headers.get("location")).pathname).toBe("/auth/error");
  const active = jar.get(`${cookieBase}-active`).value;
  expect(callback.cookies.get(`${cookieBase}-g-${active}`)?.maxAge).toBe(0);
});

test("an older Google nonce cannot exchange a code or clear the newer session", async () => {
  const { callback, exchanges, calls } = await googleFlow({ nonceChanged: true });
  expect(new URL(callback.headers.get("location")).pathname).toBe("/auth/error");
  expect(exchanges).toBe(0);
  expect(calls).not.toContain("/auth/v1/logout");
  expect(callback.cookies.getAll().filter(cookie => cookie.maxAge === 0)).toEqual([]);
});

test("SSR membership deadline includes preceding cookie renewal and cannot restart after slow Auth", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const started = Date.now(); jar.set(cookieBase, encode(session(true)));
    for (const [name, value] of Object.entries({ VERCEL_OIDC_TOKEN: jwt(), GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: "synthetic-audience",
      GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "reader@example.test", GOOGLE_AUTHORIZED_GROUP: "internal-tool-founder-ops-access@findmydoc.eu" })) vi.stubEnv(name, value);
    const previous = network;
    network = async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/auth/v1/token") { vi.setSystemTime(started+600000); return Response.json(session()); }
      if (url.pathname.endsWith("/rpc/workspace_access_context")) return Response.json({ mode: "linking", linkingEnforced: true, linked: true, userId: "user-1", profileId: "profile-1",
        identity: { sub: "google-subject", iss: "https://accounts.google.com", email: "member@findmydoc.eu", email_verified: true, custom_claims: { hd: "findmydoc.eu" } } });
      if (url.pathname.endsWith("/rpc/workspace_linking_session_allowed")) return Response.json(true);
      if (url.pathname.endsWith("/rpc/workspace_issue_permit") || url.pathname.endsWith("/rpc/workspace_release_permit")) return new Response(null, { status: 204 });
      if (url.hostname === "sts.googleapis.com") return Response.json({ access_token: "synthetic-exchange" });
      if (url.hostname === "iamcredentials.googleapis.com") return Response.json({ accessToken: "synthetic-directory", expireTime: new Date(Date.now()+3600000).toISOString() });
      if (url.hostname === "admin.googleapis.com") { vi.setSystemTime(started+900000); return Response.json({ isMember: true }); }
      return previous(input, init);
    };
    const { authorizeCredentialAction } = await publicModule();
    expect(await authorizeCredentialAction({ credential: { kind: "server-cookies" }, action: "session.planning" })).toMatchObject({ ok: false, status: 503 });
  } finally { vi.useRealTimers(); }
});

test("cookie-authenticated calendar requests use the real credential seam without a browser Bearer token", async () => {
  jar.set(cookieBase, encode(session()));
  const { authorizeCredentialAction } = await publicModule();
  const result = await authorizeCredentialAction({ credential: { kind: "session-request", request: request("/api/team-workweek/team") }, action: "calendar.read" });
  expect(result.ok).toBe(true);
});

test("cookie-authenticated mutations require the approved origin while explicit Bearer transport stays independent", async () => {
  jar.set(cookieBase, encode(session()));
  const { authorizeCredentialAction } = await publicModule();
  const denied = await authorizeCredentialAction({ credential: { kind: "session-request", request: request("/api/team-workweek/private-draft", { method: "POST" }) }, action: "workweek.private.write" });
  expect(denied).toMatchObject({ ok: false, status: 403 });
  const approved = await authorizeCredentialAction({ credential: { kind: "session-request", request: request("/api/team-workweek/private-draft", { method: "POST", headers: { origin: appOrigin } }) }, action: "workweek.private.write" });
  expect(approved.ok).toBe(true);
  const bearer = await authorizeCredentialAction({ credential: { kind: "session-request", request: request("/api/team-workweek/private-draft", { method: "POST", headers: { authorization: `Bearer ${jwt()}` } }) }, action: "workweek.private.write" });
  expect(bearer.ok).toBe(true);
});

test("an invalid supplied Bearer never falls back to a valid cookie and retired generations cannot authenticate", async () => {
  jar.set(cookieBase, encode(session()));
  const { authorizeCredentialAction } = await publicModule();
  const rejected = await authorizeCredentialAction({ credential: { kind: "session-request", request: request("/api/team-workweek/team", { headers: { authorization: "Bearer invalid" } }) }, action: "calendar.read" });
  expect(rejected).toMatchObject({ ok: false, status: 401 });
  jar.set(`${cookieBase}-g-${"legacy".padEnd(32, "0")}-revoked`, "1");
  expect(await authorizeCredentialAction({ credential: { kind: "session-request", request: request("/api/team-workweek/team") }, action: "calendar.read" })).toMatchObject({ ok: false, status: 401 });
});

test("legacy cookie adoption leaves only HttpOnly server storage and no canonical SDK session mirror", async () => {
  jar.set(cookieBase, encode(session()));
  const response = await invoke("session.current");
  expect(response.cookies.get(cookieBase)?.maxAge).toBe(0);
  expect(response.cookies.get(`${cookieBase}-g-${"legacy".padEnd(32, "0")}`)?.httpOnly).toBe(true);
  applyCookies(response);
  expect(jar.get(cookieBase)).toBeUndefined();
  const refreshed = await invoke("session.recover", mutation((await response.json()).session));
  expect(refreshed.cookies.get(cookieBase)).toBeUndefined();
});

test("server components can read an adopted legacy session even when their cookie store is immutable", async () => {
  jar.set(cookieBase, encode(session())); activeJar = { ...jar, set: () => { throw new Error("Read-only server component cookies"); } };
  const { authorizeCredentialAction } = await publicModule();
  expect(await authorizeCredentialAction({ credential: { kind: "server-cookies" }, action: "session.planning" })).toMatchObject({ ok: true, user: { id: "user-1" } });
});
