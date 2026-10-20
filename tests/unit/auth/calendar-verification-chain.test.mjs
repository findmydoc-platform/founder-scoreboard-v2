import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { generateKeyPairSync, sign } from "node:crypto";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const origin = "https://calendar-auth.example.test";
const userId = "a1111111-1111-4111-8111-111111111111";
const sessionId = "b1111111-1111-4111-8111-111111111111";
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "calendar-proof", alg: "ES256", use: "sig" };
let output, stdoutWrite, stdoutBaseWrite, listeners;
let cleanupFailure, dataRetry, directoryBody, directoryThrow;
let counts, member, directoryFailure, sessionAllowed, mappedProfile, rows, delayDirectory, role, permits, dataFailure, changedBindingAt, deniedAccountAt, currentUser, precedingAuthDelay;

function token(overrides = {}) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "ES256", typ: "JWT", kid: jwk.kid })}.${encode({
    sub: userId, session_id: sessionId, aud: "authenticated", role: "authenticated",
    iss: `${origin}/auth/v1`, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+3600,
    amr: [{ method: "oauth" }], ...overrides,
  })}`;
  return `${unsigned}.${sign("sha256", Buffer.from(unsigned), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}

async function protocol(input, init) {
  const request = new Request(input, init);
  const url = new URL(request.url);
  const count = category => { counts[category] = (counts[category] || 0) + 1; };
  if (url.pathname.endsWith("/.well-known/jwks.json")) { count("jwks"); return Response.json({ keys: [jwk] }); }
  if (url.pathname === "/auth/v1/user") { count("auth"); if (counts.auth === 1 && precedingAuthDelay) vi.setSystemTime(Date.now() + precedingAuthDelay); if (deniedAccountAt && counts.auth >= deniedAccountAt) return Response.json({ message: "Account unavailable" }, { status: 401 }); return Response.json({ id: currentUser, aud: "authenticated", identities: [] }); }
  if (url.pathname.endsWith("/rpc/workspace_access_context")) {
    count("binding");
    return Response.json({ mode: "linking", linkingEnforced: true, userId: currentUser, profileId: changedBindingAt && counts.binding >= changedBindingAt ? "rebound-profile" : mappedProfile, linked: true,
      identity: { sub: "google-subject", email: "member@findmydoc.eu", email_verified: true, iss: "https://accounts.google.com", custom_claims: { hd: "findmydoc.eu" } } });
  }
  if (url.pathname.endsWith("/rpc/workspace_linking_session_allowed")) { count("session"); return Response.json(sessionAllowed); }
  if (url.hostname === "sts.googleapis.com") { count("exchange"); return Response.json({ access_token: "synthetic-exchange" }); }
  if (url.hostname === "iamcredentials.googleapis.com") { count("impersonation"); return Response.json({ accessToken: "synthetic-directory", expireTime: new Date(Date.now()+3600000).toISOString() }); }
  if (url.hostname === "admin.googleapis.com") {
    count("directory");
    if (directoryThrow) throw directoryThrow;
    if (directoryBody) return directoryBody();
    if (delayDirectory) await delayDirectory();
    return directoryFailure ? Response.json({ error: "unavailable" }, { status: 503 }) : Response.json({ isMember: member });
  }
  if (url.pathname.endsWith("/rpc/workspace_issue_permit")) { count("permit"); permits.push(await request.json()); return new Response(null, { status: 204 }); }
  if (url.pathname.endsWith("/rpc/workspace_release_permit")) { count("release"); return cleanupFailure ? Response.json({ code: "private-cleanup-code", message: "seeded-private-cleanup-message" }, { status: 400 }) : new Response(null, { status: 204 }); }
  if (url.pathname.endsWith("/rpc/current_authenticated_profile")) { count("profile"); return Response.json({ id: mappedProfile, name: "Founder", platform_role: role }); }
  if (url.pathname === "/rest/v1/team_workweek_publications") {
    count("data");
    expect(request.headers.get("x-founderops-workspace-permit")).toBeTruthy();
    if (dataRetry && counts.data === 1) return Response.json({ message: "seeded-private-transient-failure" }, { status: 503 });
    return dataFailure ? Response.json({ message: "query rejected" }, { status: 400 }) : Response.json(rows);
  }
  throw new Error(`Unexpected protocol ${url.origin}${url.pathname}`);
}

async function application() {
  return importTestModule("src/app/api/team-workweek/team/route.ts", { "server-only": {} });
}
function request(jwt = token(), search = "") {
  const url = new URL(`https://application.example.test/api/team-workweek/team${search}`);
  return new NextRequest(url, { headers: { authorization: `Bearer ${jwt}` } });
}

beforeEach(() => {
  vi.resetModules();
  output = [];
  listeners = [process.stdout, process.stderr].map(stream => ({ stream, error: stream.listeners("error"), drain: stream.listeners("drain") }));
  const write = process.stdout.write.bind(process.stdout);
  stdoutBaseWrite = write;
  stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation((line, ...args) => {
    if (typeof line === "string" && line.includes('"scope":"calendar"')) { output.push(JSON.parse(line)); return true; }
    return write(line, ...args);
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T10:00:00Z"));
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: origin, NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "synthetic-anon", SUPABASE_URL: origin, SUPABASE_ANON_KEY: "synthetic-anon", SUPABASE_PUBLISHABLE_KEY: "synthetic-anon", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service", SUPABASE_SECRET_KEY: "synthetic-service",
    REQUIRE_SUPABASE_AUTH: "true", VERCEL_OIDC_TOKEN: token(), GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: "synthetic-audience",
    GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "reader@example.test", GOOGLE_AUTHORIZED_GROUP: "internal-tool-founder-ops-access@findmydoc.eu" })) vi.stubEnv(key, value);
  cleanupFailure = false; dataRetry = false; directoryBody = null; directoryThrow = null;
  counts = {}; member = true; directoryFailure = false; sessionAllowed = true; mappedProfile = "profile-1"; rows = []; delayDirectory = null; role = "founder"; permits = []; dataFailure = false; changedBindingAt = null; deniedAccountAt = null; currentUser = userId; precedingAuthDelay = 0;
  vi.stubGlobal("fetch", protocol);
});
afterEach(() => {
  stdoutWrite.mockRestore();
  for (const { stream, error, drain } of listeners) {
    for (const listener of stream.listeners("error")) if (!error.includes(listener)) stream.off("error", listener);
    for (const listener of stream.listeners("drain")) if (!drain.includes(listener)) stream.off("drain", listener);
  } vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("calendar route reuses membership through the real verification and permit chain", async () => {
  const route = await application();
  const jwt = token();
  const first = await route.GET(request(jwt));
  expect(first.status).toBe(200);
  const cold = { ...counts };
  expect(cold.directory).toBe(1);
  expect(cold.permit).toBe(3);
  expect(output.filter(event => event.event === "request.completed").at(-1)).toMatchObject({
    membership: { result: "miss", reason: "not_found", evidenceAgeMs: 0, remainingLifetimeMs: 900000, expired: false },
    directoryCredential: { result: "renewed" },
  });
  expect((await route.GET(request(jwt))).status).toBe(200);
  expect(counts.directory).toBe(1);
  expect(counts.permit).toBe(6);
  expect(counts.data).toBe(4);
  expect(counts.auth).toBe(8);
  expect(output.filter(event => event.event === "request.completed").at(-1)).toMatchObject({
    membership: { result: "hit", reason: "cached", evidenceAgeMs: 0, remainingLifetimeMs: 900000, expired: false },
  });
});

test("calendar summary counts actual private transport attempts and declares OIDC exclusions", async () => {
  const route = await application();
  expect((await route.GET(request())).status).toBe(200);
  const summary = output.filter(event => event.event === "request.completed").at(-1);
  expect(summary).toMatchObject({ externalCalls: { total: 21 + (counts.jwks || 0), operations: { "supabase.user": 4, "workspace.context": 4, "workspace.session": 1,
    "workspace.permit.issue": 3, "workspace.permit.release": 3, "calendar.profile": 1, "calendar.publications": 2,
    "directory.sts": 1, "directory.iam": 1, "directory.membership": 1,
  } }, completeness: { externalCallsScope: "private_supabase_and_explicit_directory_http", externalCallsComplete: false,
    uninstrumented: ["vercel_oidc_internal"] } });
  expect(summary.phases).toEqual(expect.arrayContaining([
    expect.objectContaining({ operation: "directory.membership", kind: "http", outcome: "success" }),
  ]));
});

test("activity cannot renew original membership evidence and outage at exact expiry denies", async () => {
  const route = await application(); const jwt = token(); const started = Date.now();
  expect((await route.GET(request(jwt))).status).toBe(200);
  member = false; directoryFailure = true;
  for (const elapsed of [300000, 600000, 899999]) {
    vi.setSystemTime(started + elapsed);
    expect((await route.GET(request(jwt))).status).toBe(200);
  }
  expect(counts.directory).toBe(1);
  vi.setSystemTime(started + 900000);
  expect((await route.GET(request(jwt))).status).toBe(503);
  expect(counts.directory).toBe(2);
  expect(output.filter(event => event.event === "request.completed").at(-1)).toMatchObject({
    membership: { result: "expired", reason: "observed_expiry", expired: true, evidenceAgeMs: null, remainingLifetimeMs: null }, detailRetained: true,
  });
  directoryFailure = false;
  expect((await route.GET(request(jwt))).status).toBe(403);
});

test("a verification that finishes at its original deadline provides no usable evidence", async () => {
  const route = await application(); const jwt = token(); const started = Date.now();
  precedingAuthDelay = 600000;
  delayDirectory = async () => vi.setSystemTime(started + 900000);
  expect((await route.GET(request(jwt))).status).toBe(503);
  expect(counts.data || 0).toBe(0);
  delayDirectory = null;
  member = false;
  expect((await route.GET(request(jwt))).status).toBe(403);
  expect(counts.directory).toBe(2);
});

test("a shorter JWT deadline remains binding on warm membership", async () => {
  const route = await application(); const started = Date.now();
  const jwt = token({ exp: Math.floor(started/1000)+60 });
  expect((await route.GET(request(jwt))).status).toBe(200);
  vi.setSystemTime(started + 60000);
  expect((await route.GET(request(jwt))).status).toBe(401);
  expect(counts.directory).toBe(1);
});

for (const [name, credential] of Object.entries({
  malformed: () => "malformed",
  invalidSignature: () => { const jwt = token(); return `${jwt.slice(0, jwt.lastIndexOf(".")+1)}${Buffer.alloc(64).toString("base64url")}`; },
  wrongAudience: () => token({ aud: "another-service" }),
  wrongIssuer: () => token({ iss: "https://other.example.test/auth/v1" }),
  expired: () => token({ exp: Math.floor(Date.now()/1000) }),
})) test(`rejects ${name} credentials before mutable authorization or data`, async () => {
  const route = await application();
  expect((await route.GET(request(credential()))).status).toBe(401);
  expect(counts.auth || 0).toBe(0);
  expect(counts.data || 0).toBe(0);
});

test("session removal and role removal remain authoritative on membership hits", async () => {
  const route = await application(); const jwt = token();
  expect((await route.GET(request(jwt))).status).toBe(200);
  sessionAllowed = false;
  expect((await route.GET(request(jwt))).status).toBe(403);
  sessionAllowed = true; role = "unknown-role";
  expect((await route.GET(request(jwt))).status).toBe(403);
  expect(counts.directory).toBe(1);
  expect(counts.data).toBe(2);
});

test("changed token, session and scope cannot share membership evidence", async () => {
  const route = await application();
  for (const jwt of [token(), token({ session_id: "c1111111-1111-4111-8111-111111111111" }), token({ scope: "different" })]) {
    expect((await route.GET(request(jwt))).status).toBe(200);
  }
  expect(counts.directory).toBe(3);
});

test("equivalent concurrent misses share membership but retain distinct permits", async () => {
  const route = await application(); const jwt = token();
  let release;
  delayDirectory = () => new Promise(resolve => { release = resolve; });
  const calls = [route.GET(request(jwt)), route.GET(request(jwt))];
  for (let attempts=0; attempts<100 && (!release || counts.session !== 2); attempts++) await new Promise(resolve => setImmediate(resolve));
  expect(release).toBeTypeOf("function"); release();
  const responses = await Promise.all(calls);
  expect(responses.map(response => response.status)).toEqual([200, 200]);
  expect(new Set(responses.map(response => response.headers.get("x-request-id"))).size).toBe(2);
  expect(output.filter(event => event.event === "request.completed").map(event => event.requestId).sort())
    .toEqual(responses.map(response => response.headers.get("x-request-id")).sort());
  expect(counts.directory).toBe(1);
  const summaries = output.filter(event => event.event === "request.completed");
  const executing = summaries.find(event => event.membership.result === "miss");
  const waiting = summaries.find(event => event.membership.result === "coalesced");
  expect(executing.externalCalls.operations["directory.membership"]).toBe(1);
  expect(waiting.externalCalls.operations["directory.membership"]).toBeUndefined();
  expect(waiting.membership.waitMs).toBeGreaterThanOrEqual(0);
  expect(waiting.membership.cacheOwnerId).toBe(executing.membership.cacheOwnerId);
  expect(permits).toHaveLength(6);
  expect(new Set(permits.map(permit => permit.p_hash)).size).toBe(6);
  expect(permits.every(permit => permit.p_user_id === userId && permit.p_session_id === sessionId)).toBe(true);
});

test("instance replacement cannot reuse another instance's membership cache", async () => {
  let route = await application(); const jwt = token();
  expect((await route.GET(request(jwt))).status).toBe(200);
  vi.resetModules(); route = await application(); member = false;
  expect((await route.GET(request(jwt))).status).toBe(403);
  expect(counts.directory).toBe(2);
  const owners = output.filter(event => event.event === "request.completed").map(event => event.membership.cacheOwnerId);
  expect(new Set(owners).size).toBe(2);
});

test("two live module instances have independent evidence and each keeps its original deadline", async () => {
  const first = await application(); const jwt = token(); const started = Date.now();
  expect((await first.GET(request(jwt))).status).toBe(200);
  vi.setSystemTime(started + 300000);
  vi.resetModules();
  const second = await application();
  expect((await second.GET(request(jwt))).status).toBe(200);
  expect(counts.directory).toBe(2);
  directoryFailure = true;
  vi.setSystemTime(started + 900000);
  expect((await first.GET(request(jwt))).status).toBe(503);
  expect((await second.GET(request(jwt))).status).toBe(200);
  expect(counts.directory).toBe(3);
  vi.setSystemTime(started + 1200000);
  expect((await second.GET(request(jwt))).status).toBe(503);
  expect(counts.directory).toBe(4);
});

test("copying an issued public capability cannot restart its original evidence lifetime", async () => {
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const started = Date.now();
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: request() }, action: "calendar.read" });
  expect(permission.ok).toBe(true);
  vi.setSystemTime(started + 899999);
  const copied = { ...permission, calendar: { ...permission.calendar } };
  expect((await copied.calendar.readPublishedOwners()).error).toBeNull();
  const dispatched = counts.data;
  vi.setSystemTime(started + 900000);
  expect((await copied.calendar.readPublishedOwners()).error).not.toBeNull();
  expect(counts.data).toBe(dispatched);
  expect(counts.directory).toBe(1);
});

test("calendar maps publications and owners without provider or private fields", async () => {
  const route = await application();
  rows = [{ id: "published-1", owner_profile_id: "owner-1", effective_from: "2026-10-01", effective_to: null,
    timezone: "Europe/Berlin", published_at: "2026-10-01T08:00:00Z", last_sync_at: "2026-10-01T08:00:00Z", publication_revision: 1,
    windows: [{ weekday: 1, startMinute: 540, endMinute: 720 }], refresh_token: "private-provider", draft: "private-draft" }];
  const response = await route.GET(request(token(), "?from=2026-10-01&to=2026-10-30"));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.publishedOwnerIds).toEqual(["owner-1"]);
  expect(body.calendarWorkweeks.map(workweek => workweek.id)).toEqual(["published-1"]);
  expect(JSON.stringify(body)).not.toMatch(/private-provider|private-draft|refresh_token/);
});

test("data failure preserves safe HTTP error and releases every issued permit", async () => {
  const route = await application(); dataFailure = true;
  const response = await route.GET(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Veröffentlichte Grundwochen konnten nicht geladen werden." });
  expect(counts.data).toBe(2);
  expect(counts.release).toBe(counts.permit);
});

test("changed account or profile binding between parallel operations denies the complete result", async () => {
  const route = await application(); const jwt = token();
  changedBindingAt = 4;
  expect((await route.GET(request(jwt))).status).toBe(503);
  expect(counts.data).toBe(1);
  changedBindingAt = null;
  deniedAccountAt = counts.auth + 4;
  expect((await route.GET(request(jwt))).status).toBe(503);
  expect(counts.data).toBe(2);
});

test("an already issued capability cannot outlive original evidence", async () => {
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: request() }, action: "calendar.read" });
  expect(permission.ok).toBe(true);
  const authBefore = counts.auth;
  vi.setSystemTime(Date.now() + 900000);
  expect((await permission.calendar.readPublishedOwners()).error).not.toBeNull();
  expect(counts.auth).toBe(authBefore);
  expect(counts.data || 0).toBe(0);
});

test("shared verification failure neither allows callers nor poisons the next attempt", async () => {
  const route = await application(); const jwt = token(); directoryFailure = true;
  let release;
  delayDirectory = () => new Promise(resolve => { release = resolve; });
  const calls = [route.GET(request(jwt)), route.GET(request(jwt))];
  for (let attempts=0; attempts<100 && (!release || counts.session !== 2); attempts++) await new Promise(resolve => setImmediate(resolve));
  expect(release).toBeTypeOf("function"); release();
  expect((await Promise.all(calls)).map(response => response.status)).toEqual([503, 503]);
  expect(counts.directory).toBe(1);
  const summaries = output.filter(event => event.event === "request.completed");
  expect(summaries.map(event => event.membership.result).sort()).toEqual(["coalesced", "miss"]);
  expect(summaries.reduce((sum, event) => sum + (event.externalCalls.operations["directory.membership"] || 0), 0)).toBe(1);
  expect(summaries.every(event => event.membership.evidenceAgeMs === null && event.detailRetained)).toBe(true);
  directoryFailure = false; delayDirectory = null;
  expect((await route.GET(request(jwt))).status).toBe(200);
  expect(counts.directory).toBe(2);
});

test("Directory service credentials stay bound to configured audience and account", async () => {
  const route = await application(); const jwt = token();
  expect((await route.GET(request(jwt))).status).toBe(200);
  vi.stubEnv("GOOGLE_WORKLOAD_IDENTITY_AUDIENCE", "different-audience");
  expect((await route.GET(request(jwt))).status).toBe(200);
  vi.stubEnv("GOOGLE_WORKSPACE_SERVICE_ACCOUNT", "different-reader@example.test");
  expect((await route.GET(request(jwt))).status).toBe(200);
  expect(counts.directory).toBe(3);
  expect(counts.exchange).toBe(3);
  expect(counts.impersonation).toBe(3);
});

test("an expired Directory service credential is exchanged before another probe", async () => {
  const route = await application();
  expect((await route.GET(request())).status).toBe(200);
  vi.setSystemTime(Date.now() + 3600000);
  vi.stubEnv("VERCEL_OIDC_TOKEN", token());
  expect((await route.GET(request())).status).toBe(200);
  expect(counts.directory).toBe(2);
  expect(counts.exchange).toBe(2);
  expect(counts.impersonation).toBe(2);
});

test("distinct users keep separate evidence even with otherwise matching provider facts", async () => {
  const route = await application(); const firstToken = token();
  expect((await route.GET(request(firstToken))).status).toBe(200);
  currentUser = "d1111111-1111-4111-8111-111111111111"; mappedProfile = "profile-2";
  expect((await route.GET(request(token({ sub: currentUser })))).status).toBe(200);
  currentUser = userId; mappedProfile = "profile-1";
  expect((await route.GET(request(firstToken))).status).toBe(200);
  expect(counts.directory).toBe(2);
});


test("calendar response correlates with a safe compact summary through real authorization", async () => {
  const route = await application();
  const response = await route.GET(request());
  expect(response.status).toBe(200);
  expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
  expect(output.find(event => event.event === "request.completed")).toMatchObject({
    schemaVersion: 1, scope: "calendar", operation: "calendar.request", severity: "info",
    requestId: response.headers.get("x-request-id"), method: "GET", route: "/api/team-workweek/team", status: 200,
    stage: "route", outcome: "success", completeness: { correlation: "missing", externalCallsComplete: false, cache: "observed" },
  });
  expect(counts.directory).toBe(1);
  expect(counts.permit).toBe(3);
  expect(counts.release).toBe(3);
});


test("the proxy replaces forged diagnostics and the route incorporates only its bounded safe summary", async () => {
  const route = await application();
  const { proxy } = await importTestModule("src/proxy.ts", { "server-only": {} });
  const incoming = request();
  incoming.headers.set("x-request-id", "forged-request");
  incoming.headers.set("x-founderops-proxy-observation", "forged-private-host-and-token");
  const forwarded = await proxy(incoming);
  const metadata = forwarded.headers.get("x-middleware-request-x-founderops-proxy-observation");
  expect(Buffer.byteLength(metadata)).toBeLessThan(1024);
  expect(metadata).not.toContain("forged");
  incoming.headers.set("x-founderops-proxy-observation", metadata);
  const response = await route.GET(incoming);
  const event = output.find(value => value.stage === "route");
  expect(response.headers.get("x-request-id")).toBe(forwarded.headers.get("x-request-id"));
  expect(event).toMatchObject({ requestId: response.headers.get("x-request-id"),
    proxy: { requestId: response.headers.get("x-request-id"), instanceId: expect.any(String), durationMs: expect.any(Number) },
    completeness: { correlation: "complete", externalCallsComplete: true },
  });
  expect(response.headers.has("x-founderops-proxy-observation")).toBe(false);
  expect(event.observedProcessingMs).toBeCloseTo(event.durationMs + event.proxy.durationMs, 3);
});

test.each([
  ["denied", "malformed", "", 401, false],
  ["invalid input", null, "?from=invalid&to=2026-10-30", 400, false],
  ["handled provider failure", null, "", 503, true],
])("%s returns its context ID and preserves the safe response contract", async (_name, jwt, search, expectedStatus, failData) => {
  const route = await application(); dataFailure = failData;
  const response = await route.GET(request(jwt ?? token(), search));
  expect(response.status).toBe(expectedStatus);
  const body = await response.json();
  const summary = output.find(event => event.event === "request.completed");
  expect(summary.requestId).toBe(response.headers.get("x-request-id"));
  expect(summary.status).toBe(expectedStatus);
  if (expectedStatus === 503) {
    expect(body).toEqual({ error: "Veröffentlichte Grundwochen konnten nicht geladen werden." });
    expect(output.find(event => event.event === "operation.failed")).toMatchObject({
      requestId: response.headers.get("x-request-id"), operation: "calendar.publications", severity: "error",
      failure: { errorCode: "provider_request_failed", errorCategory: "provider_http_error" },
    });
  } else {
    expect(summary.outcome).toBe(expectedStatus === 400 ? "invalid_input" : "denied");
    expect(output.some(event => event.event === "operation.failed")).toBe(false);
    if (expectedStatus === 401) expect(summary.deniedCode).toBe(body.code);
  }
});

test.each(["not-json", JSON.stringify({ version: 1, requestId: "forged", instanceId: "forged", status: 200, outcome: "success", durationMs: 0 }), "x".repeat(1024)])("invalid proxy metadata cannot select context or alter authorization", async metadata => {
  const route = await application(); const incoming = request();
  incoming.headers.set("x-request-id", "forged");
  incoming.headers.set("x-founderops-proxy-observation", metadata);
  const response = await route.GET(incoming);
  expect(response.status).toBe(200);
  const summary = output.find(event => event.event === "request.completed");
  expect(summary.requestId).toBe(response.headers.get("x-request-id"));
  expect(summary.requestId).not.toBe("forged");
  expect(summary.completeness.correlation).toBe("invalid");
  expect(summary.proxy).toBeUndefined();
});

test.each(["throw", "backpressure", "async"])("%s sink failure preserves calendar response, dispatch counts and permit cleanup", async mode => {
  const route = await application(); const jwt = token();
  const baseline = await route.GET(request(jwt)); const baselineBody = await baseline.json();
  const before = { ...counts };
  const write = stdoutBaseWrite;
  stdoutWrite.mockImplementation((line, ...args) => {
    if (typeof line === "string" && line.includes('"scope":"calendar"')) {
      if (mode === "throw") throw new Error("seeded-private-logger-exception");
      return false;
    }
    return write(line, ...args);
  });
  if (mode === "async") process.stdout.emit("error", new Error("seeded-private-stream-error"));
  const response = await route.GET(request(jwt));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(baselineBody);
  expect(response.headers.get("x-request-id")).toMatch(/^[a-f0-9-]{36}$/);
  expect(counts.directory).toBe(before.directory);
  expect(counts.auth - before.auth).toBe(4);
  expect(counts.permit - before.permit).toBe(3);
  expect(counts.release - before.release).toBe(3);
  expect(counts.data - before.data).toBe(2);
});

test("a route exception keeps its identity and private text stays out of failure output", async () => {
  const route = await application(); const incoming = request();
  const applicationError = new Error("seeded-private-application-exception", { cause: new Error("seeded-private-cause") });
  const search = vi.spyOn(incoming.nextUrl.searchParams, "get").mockImplementation(() => { throw applicationError; });
  try { await expect(route.GET(incoming)).rejects.toBe(applicationError); } finally { search.mockRestore(); }
  expect(output.find(event => event.event === "operation.failed")).toMatchObject({
    failure: { operation: "calendar.request", errorCode: "calendar_boundary_failure", errorCategory: "unexpected_error" }, severity: "error",
  });
  expect(output.find(event => event.event === "request.completed")).toMatchObject({ status: 500, outcome: "error" });
  expect(JSON.stringify(output)).not.toContain("seeded-private");
});


test("segment duration remains monotonic when wall time jumps during calendar verification", async () => {
  let monotonic = 100;
  const clock = vi.spyOn(performance, "now").mockImplementation(() => monotonic);
  vi.stubGlobal("fetch", async (...args) => { monotonic += 10; vi.setSystemTime(Date.now() - 60_000); return protocol(...args); });
  try {
    const route = await application();
    const response = await route.GET(request());
    expect(response.status).toBe(200);
    const summary = output.find(event => event.event === "request.completed");
    expect(summary.durationMs).toBeGreaterThan(0);
    expect(summary.durationMs).toBe((monotonic - 100));
    expect(summary.observedProcessingMs).toBe(summary.durationMs);
  } finally { clock.mockRestore(); }
});


test("calendar phases preserve sibling intervals, source failures and local preparation", async () => {
  const route = await application();
  expect((await route.GET(request())).status).toBe(200);
  const summary = output.filter(event => event.event === "request.completed").at(-1);
  const phases = summary.phases;
  const publications = phases.find(phase => phase.operation === "calendar.publications" && phase.kind === "operation");
  const owners = phases.find(phase => phase.operation === "calendar.owners");
  expect(publications).toBeDefined(); expect(owners).toBeDefined();
  expect(publications.parentId).toBe(owners.parentId);
  expect(owners.parentId).not.toBe(publications.id);
  expect(Math.min(publications.offsetMs + publications.durationMs, owners.offsetMs + owners.durationMs))
    .toBeGreaterThan(Math.max(publications.offsetMs, owners.offsetMs));
  expect(phases.find(phase => phase.operation === "calendar.prepare")).toBeDefined();
  expect(phases.filter(phase => phase.kind === "http").every(phase => phase.parentId)).toBe(true);
  expect(summary.durationMs).toBeLessThan(phases.reduce((sum, phase) => sum + phase.durationMs, 0));
});


test("warm evidence reports its original age and the shorter JWT deadline", async () => {
  const route = await application(); const started = Date.now(); const jwt = token({ exp: started / 1000 + 60 });
  expect((await route.GET(request(jwt))).status).toBe(200);
  vi.setSystemTime(started + 30_000);
  expect((await route.GET(request(jwt))).status).toBe(200);
  expect(output.filter(event => event.event === "request.completed").at(-1).membership).toMatchObject({
    result: "hit", evidenceAgeMs: 30_000, remainingLifetimeMs: 30_000,
  });
  expect(counts.directory).toBe(1);
});

test("late data failure retains earlier warm-hit verification without leaking provider text", async () => {
  const route = await application(); const jwt = token();
  expect((await route.GET(request(jwt))).status).toBe(200);
  dataFailure = true;
  expect((await route.GET(request(jwt))).status).toBe(503);
  const summary = output.filter(event => event.event === "request.completed").at(-1);
  expect(summary).toMatchObject({ membership: { result: "hit" }, detailRetained: true,
    failure: { operation: "calendar.publications", errorCategory: "provider_http_error", providerStatus: 400 } });
  expect(summary.phases).toEqual(expect.arrayContaining([expect.objectContaining({ operation: "supabase.claims" })]));
  expect(JSON.stringify(output)).not.toMatch(/query rejected|synthetic-service|member@findmydoc|google-subject|synthetic-audience|reader@example/);
});


test("suppressed permit cleanup errors remain observable without replay or response changes", async () => {
  const route = await application(); cleanupFailure = true;
  const response = await route.GET(request());
  expect(response.status).toBe(200);
  expect(counts.data).toBe(2); expect(counts.permit).toBe(3); expect(counts.release).toBe(3);
  expect(output).toEqual(expect.arrayContaining([expect.objectContaining({ event: "operation.failed",
    operation: "workspace.permit.release", failure: expect.objectContaining({ errorCode: "permit_cleanup_failed" }) })]));
  const summary = output.filter(event => event.event === "request.completed").at(-1);
  expect(summary).toMatchObject({ status: 200, severity: "error", detailRetained: true });
  expect(output.filter(event => event.event === "operation.failed").every(event => event.status === undefined)).toBe(true);
  expect(JSON.stringify(output)).not.toMatch(/private-cleanup|seeded-private/);
});

test("existing SDK retries count each actual dispatch and release without adding work", async () => {
  const route = await application(); dataRetry = true;
  expect((await route.GET(request())).status).toBe(200);
  expect(counts.data).toBe(3); expect(counts.permit).toBe(4); expect(counts.release).toBe(4);
  const summary = output.filter(event => event.event === "request.completed").at(-1);
  expect(summary.externalCalls.operations).toMatchObject({ "calendar.publications": 3, "workspace.permit.issue": 4, "workspace.permit.release": 4 });
  expect(JSON.stringify(output)).not.toContain("seeded-private");
});

test.each([
  ["invalid-json", () => new Response("seeded-private-json", { headers: { "content-type": "application/json" } }), null, "invalid_response"],
  ["invalid-shape", () => Response.json({ isMember: "seeded-private-value" }), null, "invalid_response"],
  ["transport", null, new TypeError("seeded-private-network"), "transport_error"],
  ["timeout", null, new DOMException("seeded-private-timeout", "TimeoutError"), "timeout"],
])("Directory %s failure keeps its safe source classification and public auth response", async (_name, body, thrown, category) => {
  const route = await application(); directoryBody = body; directoryThrow = thrown;
  const response = await route.GET(request());
  expect(response.status).toBe(503); expect((await response.json()).code).toBe("workspace_access_unavailable");
  const summary = output.filter(event => event.event === "request.completed").at(-1);
  expect(summary.failure).toMatchObject({ operation: "directory.membership", errorCategory: category });
  expect(JSON.stringify(output)).not.toContain("seeded-private");
});


test("live account denial remains an expected denial without an unexpected-error event", async () => {
  const route = await application(); deniedAccountAt = 1;
  const response = await route.GET(request());
  expect(response.status).toBe(401);
  expect(output.filter(event => event.event === "request.completed").at(-1)).toMatchObject({ outcome: "denied", severity: "info" });
  expect(output.some(event => event.event === "operation.failed")).toBe(false);
});


test("observed capacity removal stays distinct from an unexplained missing entry", async () => {
  const route = await application(); const original = token({ scope: "capacity-original" });
  expect((await route.GET(request(original))).status).toBe(200);
  for (let index = 0; index < 1024; index++) {
    expect((await route.GET(request(token({ scope: `capacity-${index}` })))).status).toBe(200);
    // The test observes serialized output; keep fixture retention independent of runtime buffering.
    if (index < 1023) output.length = 0;
  }
  expect(output.filter(event => event.event === "request.completed").at(-1).membership).toMatchObject({ result: "miss", reason: "not_found", capacityEvictions: 1 });
  expect((await route.GET(request(original))).status).toBe(200);
  expect(output.filter(event => event.event === "request.completed").at(-1).membership.reason).toBe("not_found");
  expect(counts.directory).toBe(1026);
}, 30000);


test("sink failure preserves existing SDK retries and the evidence deadline", async () => {
  const route = await application(); const started = Date.now(); const jwt = token();
  expect((await route.GET(request(jwt))).status).toBe(200);
  stdoutWrite.mockImplementation((line, ...args) => {
    if (typeof line === "string" && line.includes('"scope":"calendar"')) throw new Error("seeded-private-sink-failure");
    return stdoutBaseWrite(line, ...args);
  });
  counts.data = 0; dataRetry = true;
  const before = { ...counts };
  expect((await route.GET(request(jwt))).status).toBe(200);
  expect(counts.data).toBe(3); expect(counts.permit - before.permit).toBe(4); expect(counts.release - before.release).toBe(4);
  vi.setSystemTime(started + 900000); directoryFailure = true;
  expect((await route.GET(request(jwt))).status).toBe(503);
  expect(counts.directory).toBe(2);
});


test("nonpilot proxy requests emit no calendar telemetry", async () => {
  const { proxy } = await importTestModule("src/proxy.ts", { "server-only": {} });
  const response = await proxy(new NextRequest("https://application.example.test/planning"));
  expect(response.status).toBe(200);
  expect(response.headers.has("x-request-id")).toBe(false);
  expect(output).toEqual([]);
});
