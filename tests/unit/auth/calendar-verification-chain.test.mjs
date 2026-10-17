import { beforeEach, afterEach, expect, test, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const origin = "https://calendar-auth.example.test";
const userId = "a1111111-1111-4111-8111-111111111111";
const sessionId = "b1111111-1111-4111-8111-111111111111";
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "calendar-proof", alg: "ES256", use: "sig" };
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
    if (delayDirectory) await delayDirectory();
    return directoryFailure ? Response.json({ error: "unavailable" }, { status: 503 }) : Response.json({ isMember: member });
  }
  if (url.pathname.endsWith("/rpc/workspace_issue_permit")) { count("permit"); permits.push(await request.json()); return new Response(null, { status: 204 }); }
  if (url.pathname.endsWith("/rpc/workspace_release_permit")) { count("release"); return new Response(null, { status: 204 }); }
  if (url.pathname.endsWith("/rpc/current_authenticated_profile")) { count("profile"); return Response.json({ id: mappedProfile, name: "Founder", platform_role: role }); }
  if (url.pathname === "/rest/v1/team_workweek_publications") {
    count("data");
    expect(request.headers.get("x-founderops-workspace-permit")).toBeTruthy();
    return dataFailure ? Response.json({ message: "query rejected" }, { status: 400 }) : Response.json(rows);
  }
  throw new Error(`Unexpected protocol ${url.origin}${url.pathname}`);
}

async function application() {
  return importTestModule("src/app/api/team-workweek/team/route.ts", { "server-only": {} });
}
function request(jwt = token(), search = "") {
  const url = new URL(`https://application.example.test/api/team-workweek/team${search}`);
  return { headers: new Headers({ authorization: `Bearer ${jwt}` }), nextUrl: url };
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T10:00:00Z"));
  for (const [key, value] of Object.entries({ SUPABASE_URL: origin, SUPABASE_ANON_KEY: "synthetic-anon", SUPABASE_SERVICE_ROLE_KEY: "synthetic-service",
    REQUIRE_SUPABASE_AUTH: "true", VERCEL_OIDC_TOKEN: token(), GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: "synthetic-audience",
    GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "reader@example.test", GOOGLE_AUTHORIZED_GROUP: "internal-tool-founder-ops-access@findmydoc.eu" })) vi.stubEnv(key, value);
  counts = {}; member = true; directoryFailure = false; sessionAllowed = true; mappedProfile = "profile-1"; rows = []; delayDirectory = null; role = "founder"; permits = []; dataFailure = false; changedBindingAt = null; deniedAccountAt = null; currentUser = userId; precedingAuthDelay = 0;
  vi.stubGlobal("fetch", protocol);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("calendar route reuses membership through the real verification and permit chain", async () => {
  const route = await application();
  const jwt = token();
  const first = await route.GET(request(jwt));
  expect(first.status).toBe(200);
  const cold = { ...counts };
  expect(cold.directory).toBe(1);
  expect(cold.permit).toBe(3);
  expect((await route.GET(request(jwt))).status).toBe(200);
  expect(counts.directory).toBe(1);
  expect(counts.permit).toBe(6);
  expect(counts.data).toBe(4);
  expect(counts.auth).toBe(8);
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
  expect((await Promise.all(calls)).map(response => response.status)).toEqual([200, 200]);
  expect(counts.directory).toBe(1);
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
