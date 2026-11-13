import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";

let protocol, state, requests, elapsed;
const identity = { sub: "google-subject", email: "member@findmydoc.eu", email_verified: true,
  iss: "https://accounts.google.com", custom_claims: { hd: "findmydoc.eu" } };

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-26T10:00:00Z"));
  protocol = administratorProtocol({ claims: { amr: [{ method: "oauth" }] } });
  state = { mode: "linking", linkingEnforced: true, userId: "synthetic-user", profileId: "synthetic-profile",
    linked: true, identity, sessionAllowed: true, sessionError: false };
  requests = []; elapsed = 0;
  vi.stubEnv("GOOGLE_AUTHORIZED_GROUP", "internal-tool-founder-ops-access@findmydoc.eu");
  vi.stubEnv("GOOGLE_WORKLOAD_IDENTITY_AUDIENCE", "synthetic-audience");
  vi.stubEnv("GOOGLE_WORKSPACE_SERVICE_ACCOUNT", "synthetic-account");
  vi.stubEnv("VERCEL_OIDC_TOKEN", protocol.request().headers.get("authorization").slice(7));
  const fallback = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    const name = url.pathname.split("/").at(-1);
    requests.push({ name, time: elapsed, headers: request.headers, body: request.method === "POST" ? await request.clone().json() : null });
    elapsed += 20; vi.setSystemTime(Date.now() + 20);
    if (state.respond) { const response = await state.respond(name, request); if (response) return response; }
    if (name === "workspace_access_context" || name === "workspace_calendar_entry") return state.entryError
      ? Response.json({ code: "PGRST202", message: "Entry unavailable" }, { status: 404 }) : Response.json(state);
    if (["workspace_linking_session_allowed", "workspace_session_allowed"].includes(name)) return state.sessionError
      ? Response.json({ message: "Admission unavailable" }, { status: 500 }) : Response.json(state.sessionAllowed);
    if (name === "workspace_dispatch_prepare") return state.dispatchDenied
      ? Response.json({ code: "42501", message: "Binding changed" }, { status: 403 })
      : Response.json(state.mode === "google" || (state.mode === "linking" && state.linkingEnforced));
    if (name === "workspace_release_permit") return new Response(null, { status: 204 });
    if (url.pathname === "/auth/v1/settings") return Response.json(state.settings ?? { external: { google: true, email: false } });
    if (url.hostname === "sts.googleapis.com") return Response.json({ access_token: "synthetic-exchange" });
    if (url.hostname === "iamcredentials.googleapis.com") return Response.json({ accessToken: "synthetic-directory", expireTime: new Date(Date.now() + 3600000).toISOString() });
    if (url.hostname === "admin.googleapis.com") return Response.json({ isMember: state.member ?? true });
    if (url.pathname === "/rest/v1/rpc/planning_workspace_snapshot") return Response.json({ id: "findmydoc-founder-execution", name: "Planning", scope_revision: "42" });
    if (url.pathname.startsWith("/rest/v1/") && !url.pathname.includes("/rpc/")) return Response.json([], { headers: { "content-range": "*/0" } });
    return fallback(request);
  });
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

async function authorize(request = protocol.request()) {
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  return authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "planning.board.read" });
}
const names = () => requests.map(request => request.name);
function requestWithClaims(overrides) {
  const request = protocol.request();
  const parts = request.headers.get("authorization").slice(7).split(".");
  const claims = JSON.parse(Buffer.from(parts[1], "base64url"));
  parts[1] = Buffer.from(JSON.stringify({ ...claims, ...overrides })).toString("base64url");
  request.headers.set("authorization", `Bearer ${parts.join(".")}`);
  state.respond = name => name === "user" ? Response.json({ id: "synthetic-user", aud: "authenticated", identities: [] }) : null;
  return request;
}

test("a valid workspace member receives the fixed Board capability after live profile dispatch", async () => {
  const result = await authorize();
  expect(result.ok, JSON.stringify({ result, requests: names() })).toBe(true);
  expect(typeof result.planning.loadBoard).toBe("function");
  expect(names().filter(name => name === "user")).toHaveLength(3);
  expect(names()).toContain("workspace_dispatch_prepare");
  expect(names()).toContain("current_authenticated_profile");
  expect(names()).toContain("workspace_release_permit");
});

test("Board entry removes one serial admission hop before the unchanged profile dispatch", async () => {
  expect((await authorize()).ok).toBe(true);
  expect(names()).toEqual(["user", "user", "workspace_calendar_entry", "token", "synthetic-account:generateAccessToken", "member%40findmydoc.eu",
    "user", "workspace_dispatch_prepare", "current_authenticated_profile", "workspace_release_permit"]);
  expect(requests.find(request => request.name === "workspace_dispatch_prepare").time).toBe(140);
  expect(elapsed).toBe(200);
});

test.each(["ceo", "founder", "deputy", "viewer"])("%s retains Board reads and live checks for every subsequent dispatch", async role => {
  protocol.state.role = role;
  const result = await authorize();
  expect(result.ok).toBe(true);
  expect((await result.planning.loadBoard()).status).toBe("ready");
  expect(names().filter(name => name === "workspace_calendar_entry")).toHaveLength(1);
  expect(names().filter(name => name === "current_authenticated_profile")).toHaveLength(13);
  expect(names().filter(name => name === "workspace_dispatch_prepare")).toHaveLength(13);
  expect(names().filter(name => name === "workspace_release_permit")).toHaveLength(13);
  expect(names().filter(name => name === "user")).toHaveLength(15);
  expect(names().filter(name => name === "planning_workspace_snapshot")).toHaveLength(2);
  for (const request of requests.filter(request => request.name === "current_authenticated_profile")) {
    expect(request.headers.get("x-founderops-workspace-permit")).toBeTruthy();
    expect(request.headers.get("authorization")).toBe(protocol.request().headers.get("authorization"));
  }
});

test.each([["legacy", false], ["linking", false], ["linking", true], ["google", true]])("%s with enforcement %s preserves admission and membership rules", async (mode, enforced) => {
  Object.assign(state, { mode, linkingEnforced: enforced });
  if (!enforced) Object.assign(state, { sessionAllowed: null, sessionError: true, linked: false, identity: null });
  expect((await authorize()).ok).toBe(true);
  expect(names().filter(name => name === "workspace_calendar_entry")).toHaveLength(1);
  expect(names().some(name => name.endsWith("session_allowed"))).toBe(false);
  expect(names().includes("member%40findmydoc.eu")).toBe(enforced);
  expect(names().includes("settings")).toBe(mode === "google");
});

test.each([
  [{ profileId: null, sessionError: true }, 403, undefined],
  [{ userId: "other-user", sessionError: true }, 403, undefined],
  [{ linked: false, sessionError: true }, 403, "workspace_link_required"],
  [{ identity: { ...identity, email_verified: false }, sessionError: true }, 403, "workspace_access_denied"],
  [{ sessionAllowed: false }, 403, "workspace_google_login_required"],
  [{ sessionAllowed: null }, 403, "workspace_google_login_required"],
  [{ sessionAllowed: "true" }, 403, "workspace_google_login_required"],
  [{ sessionError: true }, 503, "workspace_access_unavailable"],
  [{ mode: "invalid" }, 503, "workspace_access_unavailable"],
  [{ entryError: true }, 503, "workspace_access_unavailable"],
  [{ member: false }, 403, "workspace_access_denied"],
  [{ mode: "google", settings: { external: { google: true, email: true } } }, 503, "workspace_access_unavailable"],
])("denies invalid entry %j with the existing error priority", async (entry, status, code) => {
  Object.assign(state, entry);
  expect(await authorize()).toMatchObject({ ok: false, status, ...(code ? { code } : {}) });
  expect(names()).not.toContain("current_authenticated_profile");
});

test("missing OAuth AMR takes priority over grouped admission failure", async () => {
  const request = requestWithClaims({ amr: [] });
  state.sessionError = true;
  expect(await authorize(request)).toMatchObject({ ok: false, status: 403, code: "workspace_google_login_required" });
});

test.each([{ iss: "https://other.example.test/auth/v1" }, { sub: "other-user" }, { role: "service_role" },
  { aud: "other" }, { session_id: "invalid" }, { exp: 1 }])("invalid claims %j fail before workspace entry", async claims => {
  expect(await authorize(requestWithClaims(claims))).toMatchObject({ ok: false, status: 401 });
  expect(names()).not.toContain("workspace_calendar_entry");
});

test("a missing token fails before any provider request", async () => {
  const request = protocol.request(); request.headers.delete("authorization");
  expect(await authorize(request)).toMatchObject({ ok: false, status: 401 });
  expect(requests).toHaveLength(0);
});

test.each([401, 503])("live authentication failure %s fails before workspace entry", async status => {
  protocol.state.authError = status;
  expect(await authorize()).toMatchObject({ ok: false, status });
  expect(names()).not.toContain("workspace_calendar_entry");
});

test.each([null, "administrator"])("an unsupported live profile role %j cannot grant Board reads", async role => {
  protocol.state.role = role;
  expect(await authorize()).toMatchObject({ ok: false, status: 403, code: "workspace_access_denied" });
  expect(names()).not.toContain("planning_workspace_snapshot");
});

test("a changed profile binding at entry cannot grant a Board capability", async () => {
  state.profileId = "rebound-profile";
  expect(await authorize()).toMatchObject({ ok: false, status: 403 });
});

test("a credential that expires during entry cannot authorize later data dispatch", async () => {
  state.respond = name => {
    if (name === "workspace_calendar_entry") vi.setSystemTime(Date.now() + 3600001);
    return null;
  };
  expect(await authorize()).toMatchObject({ ok: false, status: 503 });
  expect(names()).not.toContain("current_authenticated_profile");
});

test("a permissive legacy issuer coercion still reaches the live dispatch denial", async () => {
  state.identity = { ...identity, iss: ["https://accounts.google.com"] };
  state.dispatchDenied = true;
  expect(await authorize()).toMatchObject({ ok: false, status: 403 });
  expect(names()).toContain("member%40findmydoc.eu");
  expect(names()).toContain("workspace_dispatch_prepare");
  expect(names()).not.toContain("current_authenticated_profile");
});

test("a session revoked after entry cannot read the Board", async () => {
  const result = await authorize();
  expect(result.ok).toBe(true);
  state.dispatchDenied = true;
  expect(await result.planning.loadBoard()).toEqual({ status: "forbidden" });
  expect(names()).not.toContain("planning_workspace_snapshot");
});

test("an expired capability cannot dispatch Board reads", async () => {
  const result = await authorize();
  expect(result.ok).toBe(true);
  vi.setSystemTime(Date.now() + 900001);
  expect(await result.planning.loadBoard()).toEqual({ status: "forbidden" });
  expect(names()).not.toContain("planning_workspace_snapshot");
});

test("warm Board entry retains the original membership deadline", async () => {
  const started = Date.now();
  expect((await authorize()).ok).toBe(true);
  vi.setSystemTime(started + 899000);
  expect((await authorize()).ok).toBe(true);
  expect(names().filter(name => name === "member%40findmydoc.eu")).toHaveLength(1);
  vi.setSystemTime(started + 900001);
  state.member = false;
  expect(await authorize()).toMatchObject({ ok: false, status: 403, code: "workspace_access_denied" });
  expect(names().filter(name => name === "member%40findmydoc.eu")).toHaveLength(2);
});

test("warm Board entry cannot outlive its original JWT expiry", async () => {
  const started = Date.now();
  const request = requestWithClaims({ exp: Math.floor(started / 1000) + 60 });
  expect((await authorize(request)).ok).toBe(true);
  vi.setSystemTime(started + 30000);
  expect((await authorize(request)).ok).toBe(true);
  vi.setSystemTime(started + 60001);
  expect(await authorize(request)).toMatchObject({ ok: false, status: 401 });
  expect(names().filter(name => name === "member%40findmydoc.eu")).toHaveLength(1);
});

test("changed Directory configuration cannot reuse warm Board membership", async () => {
  expect((await authorize()).ok).toBe(true);
  vi.stubEnv("GOOGLE_WORKLOAD_IDENTITY_AUDIENCE", "changed-audience");
  state.member = false;
  expect(await authorize()).toMatchObject({ ok: false, status: 403, code: "workspace_access_denied" });
  expect(names().filter(name => name === "member%40findmydoc.eu")).toHaveLength(2);
});

test("Calendar cannot inherit warm Board membership evidence", async () => {
  expect((await authorize()).ok).toBe(true);
  state.member = false;
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const calendar = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request() }, action: "calendar.read" });
  expect(calendar).toMatchObject({ ok: false, status: 403, code: "workspace_access_denied" });
  expect(names().filter(name => name === "member%40findmydoc.eu")).toHaveLength(2);
});


test("Planning content succeeds without dispatching optional Calendar and Quick Links reads", async () => {
  state.respond = name => ["fmd_tools", "founder_events"].includes(name)
    ? Response.json({ message: "Optional provider unavailable" }, { status: 503 }) : null;
  const { GET } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
  const response = await GET(protocol.request("/api/planning-board-data"));
  expect(response.status).toBe(200);
  expect((await response.json()).model).toMatchObject({ items: [] });
  expect(names()).not.toContain("fmd_tools");
  expect(names()).not.toContain("founder_events");
});


async function authorizeServerBoard() {
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", {
    "server-only": {},
    "next/headers": { headers: async () => new Headers(), cookies: async () => protocol.cookieJar() },
    "next/cache": { unstable_cache: callback => callback },
  });
  return authorizeCredentialAction({ credential: { kind: "server-cookies" }, action: "planning.board.read" });
}
function deferredResponse() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test("SSR receipts carry the original membership deadline separately from provider session expiry", async () => {
  const started = Date.now();
  const first = await authorizeServerBoard();
  expect(first.ok).toBe(true);
  expect(first.readAuthority).toEqual({ userId: state.userId, deadline: started + 900000 });
  expect(first.readSession.expiresAt * 1000).toBeGreaterThan(first.readAuthority.deadline);
  expect(first.serverHeaderRead).toMatchObject({ ...first.readAuthority, sessionRevision: first.readSession.revision });
  expect(first.serverHeaderRead.id).not.toBe(first.readSession.revision);
  vi.setSystemTime(started + 899000);
  const second = await authorizeServerBoard();
  expect(second.ok).toBe(true);
  expect(second.readAuthority.deadline).toBe(first.readAuthority.deadline);
});

test("server Calendar and Board settle while Quick Links remains held, preserving original live dispatch guards", async () => {
  const held = deferredResponse(), started = deferredResponse();
  state.respond = name => { if (name === "fmd_tools") { started.resolve(); return held.promise; } return null; };
  const permission = await authorizeServerBoard();
  expect(permission.ok).toBe(true);
  const board = permission.planning.loadBoard();
  const slots = permission.planning.startServerHeaderSlots();
  await started.promise;
  expect((await slots.calendarEvents).headerData.calendarEvents.state).toBe("ready");
  expect((await board).status).toBe("ready");
  held.resolve(Response.json([]));
  expect((await slots.quickLinks).headerData.quickLinks.state).toBe("ready");
  for (const request of requests.filter(request => request.name === "current_authenticated_profile")) {
    expect(request.headers.get("authorization") === protocol.request().headers.get("authorization")).toBe(true);
    expect(request.headers.has("x-founderops-workspace-permit")).toBe(true);
  }
  expect(names().filter(name => name === "workspace_release_permit").length).toBe(names().filter(name => name === "current_authenticated_profile").length);
});

test("revoked server Header admission returns sanitized independent errors without optional data dispatch", async () => {
  const permission = await authorizeServerBoard();
  expect(permission.ok).toBe(true);
  state.dispatchDenied = true;
  const slots = permission.planning.startServerHeaderSlots();
  const [links, calendar] = await Promise.all([slots.quickLinks, slots.calendarEvents]);
  expect(links.headerData.quickLinks).toMatchObject({ state: "error", data: [] });
  expect(calendar.headerData.calendarEvents).toMatchObject({ state: "error", data: [] });
  expect(names()).not.toContain("fmd_tools");
  expect(names()).not.toContain("founder_events");
  expect(JSON.stringify([links, calendar])).not.toContain("Binding changed");
});

test("a slow server slot cannot outlive its earlier original authority deadline or poison its settled sibling", async () => {
  const held = deferredResponse(), started = deferredResponse();
  state.respond = name => { if (name === "fmd_tools") { started.resolve(); return held.promise; } return null; };
  const permission = await authorizeServerBoard();
  expect(permission.ok).toBe(true);
  const slots = permission.planning.startServerHeaderSlots();
  await started.promise;
  expect((await slots.calendarEvents).headerData.calendarEvents.state).toBe("ready");
  vi.setSystemTime(permission.readAuthority.deadline);
  held.resolve(Response.json([]));
  expect((await slots.quickLinks).headerData.quickLinks).toMatchObject({ state: "error", data: [] });
  expect((await slots.calendarEvents).headerData.calendarEvents.state).toBe("ready");
});

test("actual Board and Header API envelopes retain the immutable read deadline", async () => {
  const started = Date.now();
  const { GET: board } = await importTestModule("src/app/api/planning-board-data/route.ts", { "server-only": {} });
  const boardResponse = await board(protocol.request("/api/planning-board-data"));
  expect(boardResponse.status).toBe(200);
  expect((await boardResponse.json()).readAuthority).toEqual({ userId: state.userId, deadline: started + 900000 });
  const { GET: header } = await importTestModule("src/app/api/planning-header-data/route.ts", { "server-only": {}, "next/cache": { unstable_cache: callback => callback } });
  state.respond = name => name === "workspace_issue_permit" ? Response.json(null) : null;
  const headerStarted = Date.now();
  const headerResponse = await header(protocol.request("/api/planning-header-data?slots=quickLinks"));
  expect(headerResponse.status).toBe(200);
  const body = await headerResponse.json();
  expect(body.readAuthority.userId).toBe(state.userId);
  expect(body.readAuthority.deadline).toBe(headerStarted + 900000);
  expect(body.headerData.quickLinks.state).toBe("ready");
});


test("a delayed scalar observation cannot outlive its own original capability deadline", async () => {
  const held = deferredResponse(), started = deferredResponse();
  state.respond = name => { if (name === "planning_source_version") { started.resolve(); return held.promise; } return null; };
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request() }, action: "planning.revision.read" });
  expect(permission.ok).toBe(true);
  const observed = permission.planning.readSourceVersion();
  await started.promise;
  vi.setSystemTime(permission.readAuthority.deadline);
  held.resolve(Response.json("42"));
  await expect(observed).resolves.toMatchObject({ version: null, status: 503 });
});
