import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules(); vi.useRealTimers(); });

test("an event create cannot use an admission lost during participant validation", async () => {
  const protocol = administratorProtocol({ role: "ceo", snapshot: { eligible: false, active: false, expiresAt: null } });
  const authFetch = globalThis.fetch;
  let writes = 0, audits = 0;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/profiles") { protocol.state.profile = false; return Response.json([{ id: "participant-one" }]); }
    if (url.pathname === "/rest/v1/founder_events" && request.method === "POST") { writes++; return Response.json({ id: 1, ...(await request.json()) }); }
    if (url.pathname === "/rest/v1/audit_log") { audits++; return new Response(null, { status: 201 }); }
    return authFetch(request);
  });
  const { POST } = await importTestModule("src/app/api/events/route.ts", { "server-only": {}, "next/cache": { revalidateTag() {} } });
  const response = await POST(protocol.request("/api/events", "POST", { title: "Synthetic event", startsAt: "2099-01-12T10:00", audienceMode: "selected", participantProfileIds: ["participant-one"] }));
  assert.equal(response.status, 500);
  assert.equal(writes, 0);
  assert.equal(audits, 0);
});

test("a tool create cannot commit after its curated-capacity check loses the actor binding", async () => {
  const protocol = administratorProtocol({ role: "founder", snapshot: { eligible: false, active: false, expiresAt: null } });
  const authFetch = globalThis.fetch;
  let writes = 0;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/fmd_tools") {
      if (request.method === "HEAD") { protocol.state.profile = false; return new Response(null, { headers: { "content-range": "*/0" } }); }
      if (request.method === "GET") return Response.json({ sort_order: 10 });
      if (request.method === "POST") { writes++; return Response.json(await request.json()); }
    }
    if (url.pathname === "/rest/v1/audit_log") return new Response(null, { status: 201 });
    return authFetch(request);
  });
  const { POST } = await importTestModule("src/app/api/tools/route.ts", { "server-only": {}, "next/cache": { revalidateTag() {} } });
  const response = await POST(protocol.request("/api/tools", "POST", { name: "Synthetic Tool", description: "A controlled tool description.", url: "https://tools.example.test", isCurated: true }));
  assert.equal(response.status, 500);
  assert.equal(writes, 0);
});


test("supporting reads recheck the bound actor before loading protected model data", async () => {
  const protocol = administratorProtocol({ role: "viewer", snapshot: { eligible: false, active: false, expiresAt: null } });
  const authFetch = globalThis.fetch;
  let checks = 0, modelReads = 0;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/current_authenticated_profile" && ++checks > 1) return Response.json(null);
    if (url.pathname.startsWith("/rest/v1/") && !url.pathname.includes("/rpc/")) { modelReads++; return Response.json([]); }
    return authFetch(request);
  });
  const { GET } = await importTestModule("src/app/api/events-data/route.ts", { "server-only": {}, "next/cache": { unstable_cache: fn => fn } });
  const response = await GET(protocol.request("/api/events-data"));
  assert.equal(response.status, 503);
  assert.equal(modelReads, 0);
});


test("metadata cannot fetch after DNS resolution loses the admitted actor", async () => {
  const protocol = administratorProtocol({ role: "founder" });
  const authFetch = globalThis.fetch;
  let providerRequests = 0;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).hostname === "tool.example.test") { providerRequests++; return new Response("<title>Private fixture</title>", { headers: { "content-type": "text/html" } }); }
    return authFetch(request);
  });
  const { POST } = await importTestModule("src/app/api/tools/metadata/route.ts", {
    "server-only": {}, "node:dns/promises": { lookup: async () => { protocol.state.profile = false; return [{ address: "93.184.216.34", family: 4 }]; } },
  });
  const response = await POST(protocol.request("/api/tools/metadata", "POST", { url: "https://tool.example.test/page" }));
  assert.equal(response.status, 400);
  assert.equal(providerRequests, 0);
});


test("public health never dispatches with a service configuration replaced mid-check", async () => {
  administratorProtocol();
  let tasks = 0;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/profiles") { vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "synthetic-replacement"); return Response.json([]); }
    if (url.pathname === "/rest/v1/tasks") { tasks++; return Response.json([]); }
    throw new Error("Unexpected health protocol");
  });
  const { GET } = await importTestModule("src/app/api/health/route.ts", { "server-only": {} });
  const response = await GET();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).checks.coreTablesReachable, false);
  assert.equal(tasks, 0);
});


test("notification status cannot update after its ownership read loses the admitted actor", async () => {
  const protocol = administratorProtocol({ role: "founder" });
  const authFetch = globalThis.fetch;
  let writes = 0;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/notification_events" && request.method === "GET") { protocol.state.profile = false; return Response.json({ id: 7, recipient_profile_id: "synthetic-profile", status: "pending", seen_at: null, dismissed_at: null }); }
    if (url.pathname === "/rest/v1/notification_events" && request.method === "PATCH") { writes++; return new Response(null, { status: 204 }); }
    return authFetch(request);
  });
  const { PATCH } = await importTestModule("src/app/api/notifications/[id]/route.ts", { "server-only": {} });
  const response = await PATCH(protocol.request("/api/notifications/7", "PATCH", { action: "seen" }), { params: Promise.resolve({ id: "7" }) });
  assert.equal(response.status, 500);
  assert.equal(writes, 0);
});


test("Google disconnect preview stops new reads after losing its owner binding", async () => {
  const protocol = administratorProtocol({ role: "founder" });
  const authFetch = globalThis.fetch;
  let reads = 0, checks = 0;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/current_authenticated_profile" && ++checks > 1) return Response.json(null);
    if (url.pathname === "/rest/v1/team_workweek_publications") return Response.json([]);
    if (url.pathname === "/rest/v1/google_workspace_disconnect_operations") { reads++; return Response.json(null); }
    return authFetch(request);
  });
  const { GET } = await importTestModule("src/app/api/google-workspace/disconnect/route.ts", { "server-only": {} });
  const response = await GET(protocol.request("/api/google-workspace/disconnect"));
  assert.equal(response.status, 503);
  assert.equal(reads, 0);
});


test("GitHub resource helpers reject raw credentials outside their private transport", async () => {
  let attempts = 0;
  vi.stubGlobal("fetch", async () => { attempts++; return Response.json({}); });
  const { githubRequest } = await importTestModule("src/lib/github-http.ts", { "server-only": {} });
  await assert.rejects(githubRequest("https://api.github.com/user", { token: "synthetic-unbound-token", errorMessage: "Synthetic failure" }), /gebundene/);
  assert.equal(attempts, 0);
});


for (const [role, active, allowed] of [["ceo", false, true], ["deputy", false, true], ["founder", false, false], ["viewer", false, false], ["viewer", true, true]]) {
  test(`Events create retains ${role} / administrator=${active} authority and its write transport`, async () => {
    const protocol = administratorProtocol({ role, snapshot: { eligible: active, active, expiresAt: active ? new Date(Date.now() + 60000).toISOString() : null } });
    const authFetch = globalThis.fetch, effects = [], audits = [];
    vi.stubGlobal("fetch", async (input, init) => {
      const request = new Request(input, init), url = new URL(request.url);
      if (url.pathname === "/rest/v1/founder_events") { effects.push(request.headers.get("authorization")); return Response.json({ id: 12, ...(await request.json()) }); }
      if (url.pathname === "/rest/v1/audit_log") { audits.push(await request.json()); return new Response(null, { status: 201 }); }
      return authFetch(request);
    });
    const { POST } = await importTestModule("src/app/api/events/route.ts", { "server-only": {}, "next/cache": { revalidateTag() {} } });
    const response = await POST(protocol.request("/api/events", "POST", { title: "Synthetic event", startsAt: "2099-01-12T10:00" }));
    assert.equal(response.status, allowed ? 200 : 403);
    assert.equal(effects.length, allowed ? 1 : 0);
    assert.equal(audits.length, allowed ? 1 : 0);
    if (allowed) {
      assert.equal(effects[0], active ? protocol.request().headers.get("authorization") : "Bearer synthetic-service");
      assert.equal(audits[0].actor_profile_id, "synthetic-profile");
      assert.equal(audits[0].entity_id, "12");
    }
  });
}

for (const role of ["ceo", "founder", "deputy", "viewer"]) {
  test(`Tools create retains ${role} contributor authority without an administrator override`, async () => {
    const protocol = administratorProtocol({ role }), authFetch = globalThis.fetch;
    let writes = 0;
    vi.stubGlobal("fetch", async (input, init) => {
      const request = new Request(input, init), url = new URL(request.url);
      if (url.pathname === "/rest/v1/fmd_tools" && request.method === "GET") return Response.json({ sort_order: 10 });
      if (url.pathname === "/rest/v1/fmd_tools" && request.method === "POST") { writes++; return Response.json(await request.json()); }
      if (url.pathname === "/rest/v1/audit_log") return new Response(null, { status: 201 });
      return authFetch(request);
    });
    const { POST } = await importTestModule("src/app/api/tools/route.ts", { "server-only": {}, "next/cache": { revalidateTag() {} } });
    const response = await POST(protocol.request("/api/tools", "POST", { name: "Controlled tool", description: "A synthetic useful tool." }));
    assert.equal(response.status, role === "viewer" ? 403 : 200);
    assert.equal(writes, role === "viewer" ? 0 : 1);
  });
}

test("a legitimate cookie session can create Events while a cross-origin cookie mutation cannot", async () => {
  const protocol = administratorProtocol({ role: "ceo", snapshot: { eligible: false, active: false, expiresAt: null } }), authFetch = globalThis.fetch;
  vi.stubEnv("APP_URL", "https://app.example.test"); vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("VERCEL_URL", "synthetic-app.example.test");
  let writes = 0;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/founder_events") { writes++; return Response.json({ id: 12, ...(await request.json()) }); }
    if (url.pathname === "/rest/v1/audit_log") return new Response(null, { status: 201 });
    return authFetch(request);
  });
  const { POST } = await importTestModule("src/app/api/events/route.ts", { "server-only": {}, "next/cache": { revalidateTag() {} } });
  const request = origin => {
    const value = protocol.request("/api/events", "POST", { title: "Synthetic event", startsAt: "2099-01-12T10:00" });
    value.headers.delete("authorization"); value.headers.set("cookie", protocol.cookieJar().getAll().map(cookie => `${cookie.name}=${cookie.value}`).join("; "));
    value.headers.set("origin", origin); return value;
  };
  assert.equal((await POST(request("https://app.example.test"))).status, 200);
  assert.equal((await POST(request("https://other.example.test"))).status, 403);
  assert.equal(writes, 1);
});

const eventRow = () => ({ title: "Captured title", category: "other", starts_at: "2099-01-12T10:00:00.000Z", ends_at: null, location: "", description: "", audience_mode: "all", participant_profile_ids: [], reminder_days_before: 7, reminder_generated_at: null, status: "planned", updated_at: new Date().toISOString() });
test("an update capability binds original action, target, observed row and copied input before awaited checks", async () => {
  const protocol = administratorProtocol({ role: "ceo", snapshot: { eligible: false, active: false, expiresAt: null } }), authFetch = globalThis.fetch;
  const writes = [], audits = [];
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/founder_events") {
      assert.equal(url.searchParams.get("id"), "eq.7");
      if (request.method === "GET") return Response.json({ id: 7, ...eventRow() });
      const values = await request.json(); writes.push(values); return Response.json({ id: 7, ...values });
    }
    if (url.pathname === "/rest/v1/audit_log") { audits.push(await request.json()); return new Response(null, { status: 201 }); }
    return authFetch(request);
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const input = { credential: { kind: "session-request", request: protocol.request() }, action: "events.update", targetId: "7" };
  const pending = authorizeCredentialAction(input); input.action = "events.create"; input.targetId = "99";
  const permission = await pending; assert.equal(permission.ok, true);
  assert.equal((await permission.resource.saveEvent(eventRow(), {})).error.code, "42501");
  const read = await permission.resource.readEvent(); read.data.title = "Changed returned DTO"; read.data.id = 99;
  const values = eventRow(), saving = permission.resource.saveEvent(values, {}); values.title = "Changed after invocation";
  assert.equal((await saving).error, null);
  assert.equal(writes[0].title, "Captured title"); assert.equal(audits[0].before_data.title, "Captured title");
  assert.equal(audits[0].entity_id, "7");
  assert.equal((await permission.resource.saveTool({}, {})).status, 403);
  assert.equal(writes.length, 1);
});

test("a held Workspace read expires at its original verification start even with unchanged role evidence", async () => {
  const protocol = administratorProtocol({ claims: { amr: [{ method: "oauth" }] } }), authFetch = globalThis.fetch;
  for (const [name, value] of Object.entries({ GOOGLE_AUTHORIZED_GROUP: "internal-tool-founder-ops-access@findmydoc.eu", GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: "synthetic-audience", GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "synthetic@example.test", VERCEL_OIDC_TOKEN: "synthetic-oidc" })) vi.stubEnv(name, value);
  let reads = 0, memberships = 0;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.hostname === "sts.googleapis.com") return Response.json({ access_token: "synthetic-sts" });
    if (url.hostname === "iamcredentials.googleapis.com") return Response.json({ accessToken: "synthetic-directory", expireTime: new Date(Date.now() + 3600000).toISOString() });
    if (url.hostname === "admin.googleapis.com") { memberships++; return Response.json({ isMember: true }); }
    if (url.pathname.endsWith("/workspace_access_context")) return Response.json({ mode: "linking", linkingEnforced: true, linked: true, userId: "synthetic-user", profileId: "synthetic-profile", identity: { sub: "synthetic-google", iss: "https://accounts.google.com", email: "synthetic@findmydoc.eu", email_verified: true, custom_claims: { hd: "findmydoc.eu" } } });
    if (["workspace_linking_session_allowed", "workspace_issue_permit", "workspace_release_permit"].some(name => url.pathname.endsWith(`/${name}`))) return Response.json(true);
    if (!url.pathname.includes("/rpc/") && url.pathname.startsWith("/rest/v1/")) { reads++; return Response.json([]); }
    return authFetch(request);
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {}, "@vercel/oidc": { getVercelOidcToken: async () => "synthetic-oidc" }, "next/cache": { unstable_cache: load => load } });
  const started = Date.now(), permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request() }, action: "events.read" });
  assert.equal(permission.ok, true, JSON.stringify(permission));
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(started + 900001);
  assert.equal((await permission.resource.loadWorkspace()).status, "unavailable");
  assert.equal(reads, 0); assert.equal(memberships, 1);
});


test("an administrator event write cannot extend its original deadline with a late active snapshot", async () => {
  const deadline = Date.now() + 1000;
  const protocol = administratorProtocol({ role: "viewer", snapshot: { eligible: true, active: true, expiresAt: new Date(deadline).toISOString() } }), authFetch = globalThis.fetch;
  let arm = false, writes = 0, crossed = false;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/founder_events") { writes++; return Response.json({ id: 12, ...(await request.json()) }); }
    const response = await authFetch(request);
    if (arm && url.pathname.endsWith("/current_authenticated_profile")) { crossed = true; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(deadline); }
    return response;
  });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request() }, action: "events.create" });
  assert.equal(permission.ok, true);
  protocol.state.snapshot.expiresAt = new Date(deadline + 3600000).toISOString(); arm = true;
  assert.equal((await permission.resource.saveEvent(eventRow(), {})).error.code, "42501");
  assert.equal(crossed, true); assert.equal(writes, 0);
});


for (const mode of ["legacy", "linking", "google"]) {
  test(`the actual login-start action retains ${mode} provider selection and private generation cookies`, async () => {
    administratorProtocol();
    vi.stubEnv("APP_URL", "https://app.example.test"); vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("VERCEL_URL", "synthetic-app.example.test");
    const values = new Map(), jar = { getAll: () => [...values].map(([name, value]) => ({ name, value })), get: name => values.has(name) ? { value: values.get(name) } : undefined, set: (name, value) => values.set(name, value) };
    let contextReads = 0;
    vi.stubGlobal("fetch", async (input, init) => {
      const request = new Request(input, init);
      if (new URL(request.url).pathname.endsWith("/workspace_access_context")) { contextReads++; return Response.json({ mode, linkingEnforced: false }); }
      throw new Error("Unscripted login protocol");
    });
    const { POST } = await importTestModule("src/app/api/auth/session/login/route.ts", { "server-only": {}, "next/headers": { cookies: async () => jar } });
    const { NextRequest } = await import("next/server");
    const response = await POST(new NextRequest("https://app.example.test/api/auth/session/login?provider=github", { method: "POST", headers: { origin: "https://app.example.test", "content-type": "application/json" }, body: "{}" }));
    assert.equal(response.status, 200);
    const body = await response.json(), target = new URL(body.redirectTo);
    assert.equal(target.searchParams.get("provider"), mode === "google" ? "google" : "github");
    if (mode === "google") { assert.equal(target.searchParams.get("scopes"), "openid email profile"); assert.equal(target.searchParams.get("include_granted_scopes"), "false"); assert.equal(target.searchParams.get("hd"), "findmydoc.eu"); }
    assert.equal(contextReads, 1);
    assert.match(response.headers.get("set-cookie"), /HttpOnly/);
    assert.match(response.headers.get("set-cookie"), /-active=/);
    assert.deepEqual(Object.keys(body), ["redirectTo"]);
  });
}
