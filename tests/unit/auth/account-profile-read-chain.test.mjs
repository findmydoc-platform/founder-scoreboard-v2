import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";

let protocol;
let reads;
let cached;
beforeEach(() => {
  vi.resetModules();
  protocol = administratorProtocol();
  reads = [];
  cached = new Map();
  const authFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/workspace_access_context" && protocol.state.rebound) return Response.json({ mode: "legacy", userId: "synthetic-user", profileId: "other-profile" });
    if (url.pathname === "/rest/v1/rpc/current_authenticated_profile" && protocol.state.rebound) return Response.json({ id: "other-profile", name: "Other Founder", platform_role: "founder" });
    if (url.pathname === "/rest/v1/rpc/administrator_access_snapshot" && protocol.state.rebindAfterShell) {
      const response = await authFetch(request);
      protocol.state.rebound = true;
      return response;
    }
    if (url.pathname.startsWith("/rest/v1/") && !url.pathname.startsWith("/rest/v1/rpc/")) {
      const table = url.pathname.split("/").at(-1);
      reads.push({ table, query: url.searchParams, credential: request.headers.get("authorization") });
      if (protocol.state.queryFailure === table) return Response.json({ code: "42P01", message: "Synthetic query unavailable" }, { status: 400 });
      if (table === "profiles") return Response.json([{ id: "synthetic-profile", name: "Synthetic Founder", platform_role: "founder", weekly_capacity: 32 }, { id: "other-profile", name: "Other Founder", platform_role: "founder", weekly_capacity: 24 }]);
      if (table === "projects") return Response.json({ id: "findmydoc-founder-execution", name: "Planning", range_label: "Current", review_objection_window_hours: 24 });
      if (table === "notification_preferences") return Response.json(["synthetic-profile", "other-profile"].map((profile_id, index) => ({ id: index + 1, profile_id, channel: "google_chat", event_type: "task.mention", enabled: true })));
      if (table === "profile_ui_preferences") return Response.json(["synthetic-profile", "other-profile"].map(profile_id => ({ profile_id, default_workspace: "planning", default_task_view: "board", planning_filters: {}, expanded_item_ids: [], created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-01T00:00:00Z" })));
      if (["active_tasks", "planning_item_strategy", "planning_item_raci_assignments", "task_links", "notification_events", "fmd_tools", "founder_events"].includes(table)) return Response.json([]);
      throw new Error("Unexpected synthetic profile resource");
    }
    return authFetch(request);
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function framework() {
  return { "server-only": {}, "next/cache": { unstable_cache: (load, keys) => async () => {
    const key = JSON.stringify(keys);
    if (cached.has(key) && protocol.state.expireOnCacheHit) vi.setSystemTime(protocol.state.expireOnCacheHit);
    if (!cached.has(key)) cached.set(key, await load());
    return cached.get(key);
  } } };
}

it("loads the existing profile projection through a fixed public operation and preserves preference visibility and filters", async () => {
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", framework());
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request("/api/profile-data") }, action: "account.profile.read" });
  expect(permission.ok).toBe(true);
  const result = await permission.account.loadProfile();
  expect(result.status).toBe("ready");
  expect(result.model.people.map(person => person.id)).toEqual(["synthetic-profile", "other-profile"]);
  expect(result.model.preferences.map(preference => preference.profileId)).toEqual(["synthetic-profile", "other-profile"]);
  expect(result.model.notificationPreferences.map(preference => preference.profileId)).toEqual(["synthetic-profile", "other-profile"]);
  const preferences = reads.find(read => read.table === "notification_preferences");
  expect(preferences.query.get("channel")).toBe("eq.google_chat");
  expect(preferences.query.get("order")).toBe("profile_id.asc");
  expect(preferences.query.has("profile_id")).toBe(false);
  expect(preferences.credential).toBe("Bearer synthetic-service");
});

it("uses the same profile operation for the actual server cookie transport", async () => {
  const jar = protocol.cookieJar();
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", { ...framework(), "next/headers": { cookies: async () => jar } });
  const permission = await authorizeCredentialAction({ credential: { kind: "server-cookies" }, action: "account.profile.read" });
  expect(permission.ok).toBe(true);
  expect(permission.profile.id).toBe("synthetic-profile");
  expect((await permission.account.loadProfile()).status).toBe("ready");
});

it("does not combine an earlier SSR shell actor with a newly rebound profile model", async () => {
  protocol.state.rebindAfterShell = true;
  const jar = protocol.cookieJar();
  const { renderWorkspacePage } = await importTestModule("src/app/(workspaces)/workspace-page.tsx", {
    ...framework(), "next/headers": { cookies: async () => jar },
    "@/features/planning/PlanningApp": { PlanningApp: () => null },
    "@/features/planning/templates/workspace-data-unavailable-page": { WorkspaceDataUnavailablePage: () => null },
  });
  const page = await renderWorkspacePage("profile");
  expect(page.props.workspace).toBe("profile");
  expect(page.props.initialData).toBeUndefined();
  expect(reads).toEqual([]);
});

it("checks live authority before a warmed header cache can release another profile model", async () => {
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", framework());
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request("/api/profile-data") }, action: "account.profile.read" });
  expect((await permission.account.loadProfile()).status).toBe("ready");
  expect(cached.size).toBe(2);
  expect((await permission.account.loadProfile()).status).toBe("ready");
  expect(reads.filter(read => read.table === "fmd_tools")).toHaveLength(1);
  expect(reads.filter(read => read.table === "founder_events")).toHaveLength(1);
  const before = reads.length;
  protocol.state.profile = false;
  expect((await permission.account.loadProfile()).status).toBe("unavailable");
  expect(reads).toHaveLength(before);
});

it("rejects a warmed-cache result when the original token deadline passes during its await", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", framework());
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request("/api/profile-data") }, action: "account.profile.read" });
  expect((await permission.account.loadProfile()).status).toBe("ready");
  const token = protocol.request().headers.get("authorization").slice(7);
  protocol.state.expireOnCacheHit = JSON.parse(Buffer.from(token.split(".")[1], "base64url")).exp * 1000;
  expect((await permission.account.loadProfile()).status).toBe("unavailable");
});

it.each(["founder", "deputy"])("preserves the %s recipient versus operational-lead header filter", async role => {
  protocol.state.role = role;
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", framework());
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request: protocol.request("/api/profile-data") }, action: "account.profile.read" });
  expect((await permission.account.loadProfile()).status).toBe("ready");
  const notifications = reads.filter(read => read.table === "notification_events");
  expect(notifications.length).toBeGreaterThan(0);
  for (const read of notifications) {
    if (role === "deputy") expect(read.query.get("or")).toBe("(recipient_profile_id.eq.synthetic-profile,recipient_profile_id.is.null)");
    else expect(read.query.get("recipient_profile_id")).toBe("eq.synthetic-profile");
  }
});

it("preserves real profile API success, unavailable-query and unmapped-session responses", async () => {
  const { GET } = await importTestModule("src/app/api/profile-data/route.ts", framework());
  const ready = await GET(protocol.request("/api/profile-data"));
  expect(ready.status).toBe(200);
  expect((await ready.json()).currentProfile.id).toBe("synthetic-profile");
  protocol.state.queryFailure = "profile_ui_preferences";
  const unavailable = await GET(protocol.request("/api/profile-data"));
  expect(unavailable.status).toBe(503);
  expect(await unavailable.json()).toEqual({ error: "Profil konnte nicht geladen werden." });
  const before = reads.length;
  protocol.state.profile = false;
  expect((await GET(protocol.request("/api/profile-data"))).status).toBe(403);
  expect(reads).toHaveLength(before);
});


it("retains the existing anonymous fallback only for locally disabled-auth profile projection", async () => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL", ""); vi.stubEnv("REQUIRE_SUPABASE_AUTH", "false");
  vi.stubEnv("ENABLE_LOCAL_LOGIN", "true");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://localhost"); vi.stubEnv("SUPABASE_URL", "http://localhost");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", ""); vi.stubEnv("SUPABASE_SECRET_KEY", "");
  const { authorizeCredentialAction } = await importTestModule("src/lib/credentials/index.ts", framework());
  const permission = await authorizeCredentialAction({ credential: { kind: "server-cookies" }, action: "account.profile.read" });
  expect(permission.ok).toBe(true);
  expect(permission.profile).toBeNull();
  expect((await permission.account.loadProfile()).status).toBe("ready");
  expect(reads.length).toBeGreaterThan(0);
  expect(reads.every(read => read.credential === "Bearer synthetic-anon")).toBe(true);
});
