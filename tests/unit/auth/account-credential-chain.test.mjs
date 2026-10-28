import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";

let protocol;
let requests;
let expireAfterSnapshot;
let expireNextBinding;
beforeEach(() => {
  vi.resetModules();
  protocol = administratorProtocol({ claims: { amr: [{ method: "oauth" }] } });
  requests = [];
  expireAfterSnapshot = false;
  expireNextBinding = false;
  for (const [key, value] of Object.entries({ VERCEL_OIDC_TOKEN: protocol.request().headers.get("authorization").slice(7), GOOGLE_WORKLOAD_IDENTITY_AUDIENCE: "synthetic-audience", GOOGLE_WORKSPACE_SERVICE_ACCOUNT: "reader@example.test", GOOGLE_AUTHORIZED_GROUP: "internal-tool-founder-ops-access@findmydoc.eu" })) vi.stubEnv(key, value);
  protocol.permits = 0; protocol.releases = 0;
  const authFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/workspace_access_context" && expireNextBinding) {
      expireNextBinding = false;
      vi.setSystemTime(new Date(protocol.state.snapshot.expiresAt));
    }
    if (url.hostname === "sts.googleapis.com") return Response.json({ access_token: "synthetic-exchange" });
    if (url.hostname === "iamcredentials.googleapis.com") return Response.json({ accessToken: "synthetic-directory", expireTime: new Date(Date.now() + 3600000).toISOString() });
    if (url.hostname === "admin.googleapis.com") return Response.json({ isMember: true });
    if (url.pathname === "/rest/v1/rpc/workspace_access_context" && protocol.state.workspace) return Response.json({ mode: "linking", linkingEnforced: true, userId: "synthetic-user", profileId: "synthetic-profile", linked: true, identity: { sub: "google-subject", email: "member@findmydoc.eu", email_verified: true, iss: "https://accounts.google.com", custom_claims: { hd: "findmydoc.eu" } } });
    if (url.pathname === "/rest/v1/rpc/workspace_linking_session_allowed") return Response.json(true);
    if (url.pathname === "/rest/v1/rpc/workspace_issue_permit") { protocol.permits += 1; return new Response(null, { status: 204 }); }
    if (url.pathname === "/rest/v1/rpc/workspace_release_permit") { protocol.releases += 1; return new Response(null, { status: 204 }); }
    if (url.pathname === "/rest/v1/rpc/administrator_access_snapshot" && expireAfterSnapshot) expireNextBinding = true;
    if (url.pathname === "/rest/v1/rpc/update_profile_settings_transaction") {
      requests.push({ authorization: request.headers.get("authorization"), body: await request.json() });
      protocol.settingsCommits = (protocol.settingsCommits || 0) + 1;
      if (protocol.state.lostSettingsResponse && requests.length === 1) throw new TypeError("Synthetic lost mutation response");
      return Response.json({ profile: { id: "synthetic-profile", name: "Synthetic Founder", platform_role: "founder", color: "#112233" }, notification_preferences: [] });
    }
    if (protocol.state.resource) {
      const response = await protocol.state.resource(request, url);
      if (response) return response;
    }
    return authFetch(request);
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("binds the public settings operation to the verified owner and allowed fields", async () => {
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request("/api/profile-settings", "PATCH", {}) }, action: "account.settings.update" });
  expect(permission.ok).toBe(true);
  expect(Object.keys(permission).sort()).toEqual(["account", "ok", "profile"]);
  const result = await permission.account.updateSettings({ profilePatch: { focus: "Delivery", platform_role: "ceo", auth_user_id: "foreign-user" }, uiPreferences: null, notificationEvents: {}, metadata: {} });
  expect(result.error).toBeNull();
  expect(requests).toEqual([{ authorization: "Bearer synthetic-service", body: { p_profile_id: "synthetic-profile", p_profile_patch: { focus: "Delivery" }, p_ui_preferences: null, p_notification_events: {}, p_request_ip: null, p_user_agent: null } }]);
});

it("keeps the real profile settings entry owner-bound and rejects owner selection", async () => {
  const { PATCH } = await importTestModule("src/app/api/profile-settings/route.ts", { "server-only": {} });
  const denied = await PATCH(protocol.request("/api/profile-settings", "PATCH", { profileId: "foreign-profile", focus: "Changed" }));
  expect(denied.status).toBe(400);
  expect(requests).toHaveLength(0);
  const response = await PATCH(protocol.request("/api/profile-settings", "PATCH", { focus: "Delivery" }));
  expect(response.status).toBe(200);
  expect((await response.json()).profile.id).toBe("synthetic-profile");
  expect(requests[0].body.p_profile_id).toBe("synthetic-profile");
});

it("denies an unmapped session before any account mutation", async () => {
  protocol.state.profile = false;
  const { PATCH } = await importTestModule("src/app/api/profile-settings/route.ts", { "server-only": {} });
  const response = await PATCH(protocol.request("/api/profile-settings", "PATCH", { focus: "Delivery" }));
  expect(response.status).toBe(403);
  expect(requests).toHaveLength(0);
});

it("offers a fixed administrator project transaction without exposing its user client", async () => {
  protocol.state.responses.update_administration_github_project_transaction_v2 = { project: { id: "findmydoc-founder-execution" } };
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request("/api/founderops-settings/github-project", "PATCH", {}) }, action: "account.github-project.update" });
  expect(permission.ok).toBe(true);
  expect("data" in permission).toBe(false);
  expect((await permission.account.updateGitHubProject({ expectedOwner: "example", expectedNumber: 1, expectedTeamSlug: "", owner: "example", number: 2, teamSlug: "", metadata: {} })).error).toBeNull();
  expect(protocol.calls).toEqual([{ name: "update_administration_github_project_transaction_v2", body: { p_project_id: "findmydoc-founder-execution", p_expected_owner: "example", p_expected_number: 1, p_expected_team_slug: "", p_github_project_owner: "example", p_github_project_number: 2, p_github_mention_team_slug: null, p_request_ip: null, p_user_agent: null } }]);
});

it("does not dispatch a project mutation when the original administrator deadline passes during the final binding await", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  protocol.state.snapshot.expiresAt = new Date(Date.now() + 1000).toISOString();
  protocol.state.responses.update_administration_github_project_transaction_v2 = { project: { id: "findmydoc-founder-execution" } };
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request("/api/founderops-settings/github-project", "PATCH", {}) }, action: "account.github-project.update" });
  expect(permission.ok).toBe(true);
  expireAfterSnapshot = true;
  const result = await permission.account.updateGitHubProject({ expectedOwner: "example", expectedNumber: 1, expectedTeamSlug: "", owner: "example", number: 2, teamSlug: "", metadata: {} });
  expect(result.error).not.toBeNull();
  expect(protocol.calls).toEqual([]);
});

it("releases an individual Workspace permit when the final administrator guard rejects dispatch", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  protocol.state.workspace = true;
  protocol.state.snapshot.expiresAt = new Date(Date.now() + 1000).toISOString();
  protocol.state.responses.update_administration_github_project_transaction_v2 = { project: {} };
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request("/api/founderops-settings/github-project", "PATCH", {}) }, action: "account.github-project.update" });
  expect(permission.ok ? true : { status: permission.status, code: permission.code }).toBe(true);
  const issued = protocol.permits;
  expireAfterSnapshot = true;
  expect((await permission.account.updateGitHubProject({ expectedOwner: "example", expectedNumber: 1, expectedTeamSlug: "", owner: "example", number: 2, teamSlug: "", metadata: {} })).error).not.toBeNull();
  expect(protocol.calls).toEqual([]);
  expect(protocol.permits).toBe(issued + 2);
  expect(protocol.releases).toBe(protocol.permits);
});

it("binds CEO governance to its original target and excludes technical identity fields", async () => {
  protocol.state.role = "ceo";
  protocol.state.responses.update_profile_governance_transaction = { profile: { id: "bound-target" } };
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const input = { credential: { kind: "session-request", request: protocol.request("/api/profiles/bound-target", "PATCH", {}) }, action: "account.governance.update", targetProfileId: "bound-target" };
  const pending = authorizeCredentialAction(input);
  input.targetProfileId = "foreign-target";
  const permission = await pending;
  expect(permission.ok).toBe(true);
  const result = await permission.account.updateGovernance({ platform_role: "founder", weekly_capacity: 31, github_login: "excluded", auth_user_id: "excluded" }, {});
  expect(result.error).toBeNull();
  expect(protocol.calls).toEqual([{ name: "update_profile_governance_transaction", body: { p_profile_id: "bound-target", p_profile_patch: { platform_role: "founder", weekly_capacity: 31 }, p_request_ip: null, p_user_agent: null } }]);
});

it("keeps notification preference authority owner-bound with its exact channel and conflict key", async () => {
  const writes = [];
  protocol.state.resource = async (request, url) => {
    if (url.pathname === "/rest/v1/profiles") return Response.json({ id: "synthetic-profile" });
    if (url.pathname === "/rest/v1/notification_preferences") {
      const body = await request.json();
      writes.push({ body, conflict: url.searchParams.get("on_conflict"), authorization: request.headers.get("authorization") });
      return Response.json({ id: 1, ...body });
    }
    if (url.pathname === "/rest/v1/audit_log") return new Response(null, { status: 201 });
  };
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request("/api/notification-preferences", "PATCH", {}) }, action: "account.notifications.update" });
  expect(permission.ok).toBe(true);
  const foreign = await permission.account.updateNotificationPreference({ profileId: "foreign-profile", eventType: "task.mention", enabled: true, metadata: {} });
  expect(foreign.error).toMatchObject({ status: 403 });
  expect(writes).toEqual([]);
  const own = await permission.account.updateNotificationPreference({ profileId: "synthetic-profile", eventType: "task.mention", enabled: false, metadata: {} });
  expect(own.error).toBeNull();
  expect(writes).toEqual([{ body: { profile_id: "synthetic-profile", channel: "google_chat", event_type: "task.mention", enabled: false, updated_at: expect.any(String) }, conflict: "profile_id,channel,event_type", authorization: "Bearer synthetic-service" }]);
});

it("acknowledges a validated tour for the verified profile without a caller-selected owner", async () => {
  protocol.state.role = "viewer";
  const writes = [];
  protocol.state.resource = async (request, url) => {
    if (url.pathname === "/rest/v1/profile_feature_tour_acknowledgements") {
      const body = await request.json();
      writes.push({ body, conflict: url.searchParams.get("on_conflict") });
      return Response.json(body);
    }
  };
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request("/api/profile-feature-tours/seen", "POST", {}) }, action: "account.tour.acknowledge" });
  expect(permission.ok).toBe(true);
  expect((await permission.account.acknowledgeTour("planning-tour", "foreign-profile")).error).toBeNull();
  expect(writes).toEqual([{ body: { profile_id: "synthetic-profile", tour_id: "planning-tour", seen_at: expect.any(String) }, conflict: "profile_id,tour_id" }]);
});

it("does not replay a profile settings transaction after a possibly committed response is lost", async () => {
  protocol.state.lostSettingsResponse = true;
  const { PATCH } = await importTestModule("src/app/api/profile-settings/route.ts", { "server-only": {} });
  const response = await PATCH(protocol.request("/api/profile-settings", "PATCH", { focus: "Delivery" }));
  expect(response.status).toBe(500);
  expect(requests).toHaveLength(1);
  expect(protocol.settingsCommits).toBe(1);
});


it("rejects an unknown account action before creating an account capability", async () => {
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request() }, action: "account.foreign.execute" });
  expect(permission.ok).toBe(false);
  expect(permission.status).toBe(403);
  expect(requests).toHaveLength(0);
});

it("does not reuse an issued account capability after its Directory provider configuration changes", async () => {
  protocol.state.workspace = true;
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { "server-only": {} });
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request("/api/profile-settings", "PATCH", {}) }, action: "account.settings.update" });
  expect(permission.ok).toBe(true);
  vi.stubEnv("GOOGLE_WORKLOAD_IDENTITY_AUDIENCE", "replacement-synthetic-audience");
  const result = await permission.account.updateSettings({ profilePatch: { focus: "Delivery" }, uiPreferences: null, notificationEvents: {}, metadata: {} });
  expect(result.error).not.toBeNull();
  expect(requests).toHaveLength(0);
});


it("preserves real preference route ownership, missing-record and query-failure responses", async () => {
  let missing = false, failed = false;
  const writes = [];
  protocol.state.resource = async (request, url) => {
    if (url.pathname === "/rest/v1/profiles") return missing ? Response.json({ code: "PGRST116", message: "Missing" }, { status: 406 }) : Response.json({ id: "synthetic-profile" });
    if (url.pathname === "/rest/v1/notification_preferences") {
      const body = await request.json(); writes.push(body);
      return failed ? Response.json({ code: "42P01", message: "Synthetic preference failure" }, { status: 400 }) : Response.json({ id: 7, ...body });
    }
    if (url.pathname === "/rest/v1/audit_log") return new Response(null, { status: 201 });
  };
  const { PATCH } = await importTestModule("src/app/api/notification-preferences/route.ts", { "server-only": {} });
  const request = profileId => protocol.request("/api/notification-preferences", "PATCH", { profileId, eventType: "task.mention", enabled: false });
  expect((await PATCH(request("foreign-profile"))).status).toBe(403);
  expect(writes).toHaveLength(0);
  const saved = await PATCH(request("synthetic-profile"));
  expect(saved.status).toBe(200);
  expect(await saved.json()).toEqual({ preference: { id: 7, profileId: "synthetic-profile", channel: "google_chat", eventType: "task.mention", enabled: false } });
  missing = true;
  expect((await PATCH(request("synthetic-profile"))).status).toBe(404);
  missing = false; failed = true;
  expect((await PATCH(request("synthetic-profile"))).status).toBe(500);
  protocol.state.role = "viewer";
  expect((await PATCH(request("synthetic-profile"))).status).toBe(403);
});

it("preserves the actual tour acknowledgement response and unavailable-table error", async () => {
  let failed = false;
  protocol.state.resource = async (request, url) => {
    if (url.pathname === "/rest/v1/profile_feature_tour_acknowledgements") return failed ? Response.json({ code: "42P01", message: "Synthetic unavailable table" }, { status: 400 }) : Response.json(await request.json());
  };
  const { POST } = await importTestModule("src/app/api/profile-feature-tours/seen/route.ts", { "server-only": {} });
  const response = await POST(protocol.request("/api/profile-feature-tours/seen", "POST", { tourId: "planning-tour", profileId: "foreign-profile" }));
  expect(response.status).toBe(200);
  expect((await response.json()).acknowledgement).toMatchObject({ profileId: "synthetic-profile", tourId: "planning-tour" });
  failed = true;
  expect((await POST(protocol.request("/api/profile-feature-tours/seen", "POST", { tourId: "planning-tour" }))).status).toBe(503);
});

it("identifies the real settings color collision without reclassifying credential replacement", async () => {
  const previousFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init);
    if (new URL(request.url).pathname === "/rest/v1/rpc/update_profile_settings_transaction") return Response.json({ code: "P0001", message: "Synthetic color collision" }, { status: 400 });
    return previousFetch(request);
  });
  const { PATCH } = await importTestModule("src/app/api/profile-settings/route.ts", { "server-only": {} });
  const response = await PATCH(protocol.request("/api/profile-settings", "PATCH", { color: "#3b82f6", profileColorDuplicateMode: false }));
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "profile_color_conflict" });
});
