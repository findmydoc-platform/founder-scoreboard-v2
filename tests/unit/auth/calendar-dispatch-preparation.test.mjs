import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const origin = "https://calendar-dispatch.example.test";
const userId = "a2222222-2222-4222-8222-222222222222";
const sessionId = "b2222222-2222-4222-8222-222222222222";
const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "calendar-dispatch", alg: "ES256", use: "sig" };
const digest = value => createHash("sha256").update(value).digest("hex");
let attempts, preparations, releases, dispatched, mode, enforced, preparedResponse, duringPreparation,
  cleanupFailure, profileFailure, dataFailure, userResponses, liveUser, owners, transientData;
function token() {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const unsigned = `${encode({ alg: "ES256", typ: "JWT", kid: jwk.kid })}.${encode({ sub: userId, session_id: sessionId,
    aud: "authenticated", role: "authenticated", iss: `${origin}/auth/v1`, iat: Math.floor(Date.now()/1000),
    exp: Math.floor(Date.now()/1000) + 3600, amr: [{ method: "oauth" }] })}`;
  return `${unsigned}.${sign("sha256", Buffer.from(unsigned), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
}
async function protocol(input, init) {
  const request = new Request(input, init); const url = new URL(request.url); const path = url.pathname;
  attempts.push(path);
  if (path.endsWith("/.well-known/jwks.json")) return Response.json({ keys: [jwk] });
  if (path === "/auth/v1/user") { userResponses++; return liveUser ? liveUser(userResponses) : Response.json({ id: userId, aud: "authenticated" }); }
  if (path === "/auth/v1/settings") return Response.json({ external: { google: true } });
  if (path.endsWith("/rpc/workspace_access_context") || path.endsWith("/rpc/workspace_calendar_entry")) return Response.json({ mode, linkingEnforced: enforced,
    sessionAllowed: (mode === "google" || (mode === "linking" && enforced)) ? true : null, sessionError: false,
    userId, profileId: "calendar-member", linked: true, identity: { sub: "google-member", email: "member@findmydoc.eu",
      email_verified: true, iss: "https://accounts.google.com", custom_claims: { hd: "findmydoc.eu" } } });
  if (path.endsWith("/rpc/workspace_linking_session_allowed") || path.endsWith("/rpc/workspace_session_allowed")) return Response.json(true);
  if (url.hostname === "sts.googleapis.com") return Response.json({ access_token: "synthetic-sts" });
  if (url.hostname === "iamcredentials.googleapis.com") return Response.json({ accessToken: "synthetic-directory", expireTime: new Date(Date.now()+3600000).toISOString() });
  if (url.hostname === "admin.googleapis.com") return Response.json({ isMember: true });
  if (path.endsWith("/rpc/workspace_calendar_prepare")) {
    const body = await request.json(); preparations.push(body);
    await duringPreparation?.(body);
    if (preparedResponse) return preparedResponse(body, preparations.length);
    return Response.json(mode === "google" || (mode === "linking" && enforced));
  }
  if (path.endsWith("/rpc/workspace_issue_permit")) return new Response(null, { status: 204 });
  if (path.endsWith("/rpc/workspace_release_permit")) {
    releases.push(await request.json());
    return cleanupFailure ? Response.json({ message: "sensitive cleanup details" }, { status: 500 }) : new Response(null, { status: 204 });
  }
  if (path.endsWith("/rpc/current_authenticated_profile")) {
    dispatched.push(request);
    return profileFailure ? Response.json({ message: "sensitive profile details" }, { status: 500 })
      : Response.json({ id: "calendar-member", name: "Member", platform_role: "viewer" });
  }
  if (path === "/rest/v1/profiles") {
    dispatched.push(request);
    if (transientData) { transientData = false; return Response.json({ message: "transient read failure" }, { status: 503 }); }
    if (dataFailure) return Response.json({ message: "sensitive calendar details" }, { status: 400 });
    const after = url.searchParams.get("id")?.replace(/^gt\./, "");
    const remaining = owners.filter(owner => !after || owner > after);
    const page = remaining.slice(0,100).map(id => ({ id, calendar: [], tail: [] }));
    return Response.json(page, { headers: { "content-range": page.length ? `0-${page.length-1}/${remaining.length}` : "*/0" } });
  }
  throw new Error("Unexpected synthetic transport operation");
}
async function authorize(jwt = token(), action = "calendar.read") {
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  return authorizeCredentialAction({ credential: { kind: "session-request", request: new NextRequest("https://application.example.test/api/team-workweek/team", { headers: { authorization: `Bearer ${jwt}` } }) }, action });
}
beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-21T10:00:00Z"));
  for (const [key, value] of Object.entries({ NEXT_PUBLIC_SUPABASE_URL: origin, NEXT_PUBLIC_SUPABASE_ANON_KEY: "synthetic-anon",
    SUPABASE_SERVICE_ROLE_KEY: "synthetic-service", REQUIRE_SUPABASE_AUTH: "true", VERCEL_OIDC_TOKEN: token(),
    GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: "synthetic-audience", GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "reader@example.test",
    GOOGLE_AUTHORIZED_GROUP: "internal-tool-founder-ops-access@findmydoc.eu" })) vi.stubEnv(key, value);
  attempts = []; preparations = []; releases = []; dispatched = []; mode = "linking"; enforced = true;
  preparedResponse = undefined; duringPreparation = undefined; cleanupFailure = false; profileFailure = false; dataFailure = false; userResponses = 0; liveUser = undefined; owners = []; transientData = false;
  vi.stubGlobal("fetch", protocol);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test("a viewer reads Calendar with grouped preparation while preserving user JWT and distinct permits", async () => {
  const jwt = token(); const authorized = await authorize(jwt);
  expect(authorized).toMatchObject({ ok: true });
  expect(await authorized.calendar.readSnapshot("2026-10-21")).toEqual({ data: { publishedOwnerIds: [], publications: [] }, error: null });
  expect(preparations).toHaveLength(2);
  expect(userResponses).toBe(3);
  expect(attempts.filter(path => path.endsWith("/rpc/workspace_access_context"))).toHaveLength(0);
  expect(attempts.filter(path => path.endsWith("/rpc/workspace_calendar_entry"))).toHaveLength(1);
  expect(attempts.filter(path => path.endsWith("/rpc/workspace_issue_permit"))).toHaveLength(0);
  expect(releases).toHaveLength(2);
  for (const [index, request] of dispatched.entries()) {
    const permit = request.headers.get("x-founderops-workspace-permit");
    expect(request.headers.get("authorization")).toBe(`Bearer ${jwt}`);
    expect(preparations[index]).toMatchObject({ p_hash: digest(permit), p_jwt_hash: digest(jwt), p_user_id: userId,
      p_session_id: sessionId, p_profile_id: "calendar-member", p_mode: "linking", p_linking_enforced: true,
      p_subject: "google-member", p_email: "member@findmydoc.eu", p_method: request.method,
      p_path: new URL(request.url).pathname.slice("/rest/v1".length) });
    expect(releases[index].p_hash).toBe(digest(permit));
  }
  expect(preparations[0].p_hash).not.toBe(preparations[1].p_hash);
});


test("expiry during live Auth prevents preparation and protected profile dispatch", async () => {
  liveUser = async attempt => {
    if (attempt === 2) vi.setSystemTime(Date.now() + 900000);
    return Response.json({ id: userId, aud: "authenticated" });
  };
  expect(await authorize()).toMatchObject({ ok: false, status: 503 });
  expect(preparations).toHaveLength(0);
  expect(dispatched).toHaveLength(0);
});


test("a lost preparation response is not replayed and cleans up its known hash", async () => {
  preparedResponse = () => { throw new TypeError("synthetic lost response"); };
  expect(await authorize()).toMatchObject({ ok: false, status: 403, error: "Teamprofil konnte nicht eindeutig geprüft werden." });
  expect(preparations).toHaveLength(1);
  expect(releases).toEqual([{ p_hash: preparations[0].p_hash }]);
  expect(dispatched).toHaveLength(0);
});

test("authority denial creates no cleanup attempt and keeps the protected profile error", async () => {
  preparedResponse = () => Response.json({ code: "42501", message: "sensitive binding details" }, { status: 403 });
  expect(await authorize()).toMatchObject({ ok: false, status: 403, error: "Teamprofil konnte nicht eindeutig geprüft werden." });
  expect(preparations).toHaveLength(1);
  expect(releases).toEqual([]);
  expect(dispatched).toHaveLength(0);
});

for (const body of [null, {}, "true", 1, false]) test(`malformed preparation result ${JSON.stringify(body)} cannot dispatch`, async () => {
  preparedResponse = () => Response.json(body);
  expect(await authorize()).toMatchObject({ ok: false, status: 403, error: "Teamprofil konnte nicht eindeutig geprüft werden." });
  expect(preparations).toHaveLength(1);
  expect(releases).toEqual([{ p_hash: preparations[0].p_hash }]);
  expect(dispatched).toHaveLength(0);
});

test("expiry after issuance cleans the profile permit without dispatch", async () => {
  duringPreparation = () => vi.setSystemTime(Date.now() + 900000);
  expect(await authorize()).toMatchObject({ ok: false, status: 503 });
  expect(preparations).toHaveLength(1);
  expect(releases).toEqual([{ p_hash: preparations[0].p_hash }]);
  expect(dispatched).toHaveLength(0);
});

test("a data rejection cleans up and returns no partial Calendar snapshot", async () => {
  const authorized = await authorize(); expect(authorized.ok).toBe(true); dataFailure = true;
  expect(await authorized.calendar.readSnapshot("2026-10-21")).toEqual({ data: null, error: { message: "Calendar snapshot is unavailable." } });
  expect(preparations).toHaveLength(2); expect(releases).toHaveLength(2);
});

test("cleanup failure never changes successful data or replays preparation", async () => {
  cleanupFailure = true;
  const authorized = await authorize(); expect(authorized.ok).toBe(true);
  expect((await authorized.calendar.readSnapshot("2026-10-21")).error).toBe(null);
  expect(preparations).toHaveLength(2); expect(dispatched).toHaveLength(2); expect(releases).toHaveLength(2);
});

for (const [workspaceMode, linkingEnforced] of [["legacy", false], ["linking", false]]) test(`${workspaceMode} without enforcement validates binding without permits`, async () => {
  mode = workspaceMode; enforced = linkingEnforced;
  const authorized = await authorize(); expect(authorized.ok).toBe(true);
  expect((await authorized.calendar.readSnapshot("2026-10-21")).error).toBe(null);
  expect(preparations).toHaveLength(2); expect(releases).toEqual([]);
  expect(userResponses).toBe(3);
  expect(dispatched.every(request => !request.headers.has("x-founderops-workspace-permit"))).toBe(true);
});


test("each profile continuation and permitted read retry receives a new independent preparation", async () => {
  owners = Array.from({ length: 101 }, (_,index) => `owner-${String(index).padStart(3,"0")}`);
  const authorized = await authorize(); expect(authorized.ok).toBe(true);
  transientData = true;
  const snapshot = await authorized.calendar.readSnapshot("2026-10-21");
  expect(snapshot).toEqual({ data: { publishedOwnerIds: owners, publications: [] }, error: null });
  expect(preparations).toHaveLength(4); expect(releases).toHaveLength(4); expect(userResponses).toBe(5);
  expect(new Set(preparations.map(preparation => preparation.p_hash)).size).toBe(4);
});

test("loss of binding between profile pages denies the whole snapshot", async () => {
  owners = Array.from({ length: 101 }, (_,index) => `owner-${String(index).padStart(3,"0")}`);
  const authorized = await authorize(); expect(authorized.ok).toBe(true);
  preparedResponse = (_body, attempt) => attempt === 3
    ? Response.json({ code: "42501", message: "changed binding" }, { status: 403 }) : Response.json(true);
  expect(await authorized.calendar.readSnapshot("2026-10-21")).toEqual({ data: null, error: { message: "Calendar snapshot is unavailable." } });
  expect(preparations).toHaveLength(3); expect(dispatched).toHaveLength(2); expect(releases).toHaveLength(2);
});


test("a lost snapshot preparation response never causes the read SDK to prepare again", async () => {
  const authorized = await authorize(); expect(authorized.ok).toBe(true);
  preparedResponse = () => { throw new TypeError("synthetic lost writing response"); };
  const snapshot = await authorized.calendar.readSnapshot("2026-10-21");
  expect(snapshot).toEqual({ data: null, error: { message: "Calendar snapshot is unavailable." } });
  expect(preparations).toHaveLength(2);
  expect(releases).toHaveLength(2);
  expect(releases[1].p_hash).toBe(preparations[1].p_hash);
  expect(dispatched).toHaveLength(1);
}, 20000);
