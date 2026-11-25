import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";
import { importTestModule } from "../../helpers/vitest-module.mjs";

let protocol, reads;
const profileIds = ["synthetic-profile", "other-profile"];
const preferenceRows = () => profileIds.map(profile_id => ({ profile_id, default_workspace: "planning", default_task_view: "board",
  planning_filters: { initiativeId: `${profile_id}-saved-filter-outside-options` }, expanded_item_ids: [`${profile_id}-saved-expanded-outside-options`],
  created_at: "2026-11-01T00:00:00Z", updated_at: "2026-11-02T00:00:00Z" }));
beforeEach(() => {
  vi.resetModules();
  protocol = administratorProtocol();
  reads = [];
  const transport = globalThis.fetch;
  vi.stubGlobal("fetch", async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/planning_source_version") return Response.json("42");
    if (url.pathname === "/rest/v1/rpc/planning_board_publication_context") {
      const identity = await transport(new Request(new URL("/rest/v1/rpc/current_authenticated_profile", url), { method: "POST", headers: request.headers, body: "{}", signal: request.signal }));
      if (!identity.ok) return identity;
      const actor = await identity.json();
      return Response.json(actor ? { profile_id: actor.id, platform_role: actor.platform_role, source_revision: "42" } : null);
    }
    if (url.pathname.startsWith("/rest/v1/") && !url.pathname.startsWith("/rest/v1/rpc/")) {
      const table = url.pathname.split("/").at(-1);
      reads.push({ table, query: url.searchParams });
      if (["active_tasks", "planning_item_strategy", "planning_item_raci_assignments", "task_links"].includes(table)) return Response.json({ code: "42P01", message: "Planning enumeration intentionally unavailable" }, { status: 400 });
      if (table === "profiles") return Response.json(profileIds.map((id, index) => ({ id, name: index ? "Other Founder" : "Synthetic Founder", platform_role: "founder", org_role: "Founder", focus: index ? "Other focus" : "Independent focus", weekly_capacity: index ? 24 : 37 })), { headers: { "content-range": "0-1/2" } });
      if (table === "projects") return Response.json({ id: "findmydoc-founder-execution", name: "Planning", range_label: "Current", review_objection_window_hours: 24 });
      if (table === "profile_ui_preferences") return Response.json(preferenceRows(), { headers: { "content-range": "0-1/2" } });
      if (table === "notification_preferences") return Response.json(profileIds.map((profile_id, index) => ({ id: index + 1, profile_id, channel: "google_chat", event_type: "task.mention", enabled: true })), { headers: { "content-range": "0-1/2" } });
      if (["notification_events", "fmd_tools", "founder_events"].includes(table)) return Response.json([], { headers: { "content-range": "*/0" } });
      throw new Error("Unexpected independent Profile data collection");
    }
    return transport(request);
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
const framework = () => ({ "server-only": {}, "next/cache": { unstable_cache: load => load } });
function expectNoPlanningEnumeration() {
  expect(reads.filter(read => ["active_tasks", "planning_item_strategy", "planning_item_raci_assignments", "task_links"].includes(read.table))).toEqual([]);
  const notificationRead = reads.find(read => read.table === "notification_preferences");
  expect(notificationRead.query.get("channel")).toBe("eq.google_chat");
  expect(notificationRead.query.get("order")).toBe("profile_id.asc");
  expect(notificationRead.query.has("profile_id")).toBe(false);
}
function expectPreferences(preferences) {
  expect(preferences.map(row => row.profileId)).toEqual(profileIds);
  for (const id of profileIds) expect(preferences.find(row => row.profileId === id)).toMatchObject({
    planningFilters: { initiativeId: `${id}-saved-filter-outside-options` }, expandedInitiativeIds: [`${id}-saved-expanded-outside-options`],
  });
}

it("Profile API retains complete authorized settings and off-page preferences when Planning enumeration fails", async () => {
  const { GET } = await importTestModule("src/app/api/profile-data/route.ts", framework());
  const response = await GET(protocol.request("/api/profile-data"));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.currentProfile).toMatchObject({ id: "synthetic-profile", platformRole: "founder" });
  expect(body.model.people.map(row => row.id)).toEqual(profileIds);
  expect(body.model.people[0]).toMatchObject({ focus: "Independent focus", weeklyCapacity: 37, persistenceBasis: { platform_role: "founder", weekly_capacity: 37 } });
  expectPreferences(body.model.preferences);
  expect(body.model.notificationPreferences.map(row => row.profileId)).toEqual(profileIds);
  expect(body.model.initiatives).toEqual([]);
  expect(body.model.readCoverage).toMatchObject({ people: "complete", preferences: "complete", notificationPreferences: "complete", initiatives: "partial" });
  expectNoPlanningEnumeration();
});

it("Profile API can defer its notification header for independent preview and count reads", async () => {
  const { GET } = await importTestModule("src/app/api/profile-data/route.ts", framework());
  const response = await GET(protocol.request("/api/profile-data?header=independent"));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.headerData.notifications.state).toBe("idle");
  expect(reads.filter(read => read.table === "notification_events")).toEqual([]);
  expectPreferences(body.model.preferences);
});

it("direct Profile SSR publishes complete independent settings without waiting for Planning options", async () => {
  const { renderWorkspacePage } = await importTestModule("src/app/(workspaces)/workspace-page.tsx", {
    ...framework(), "next/headers": { cookies: async () => protocol.cookieJar() },
    "@/features/planning/PlanningApp": { PlanningApp: () => null },
    "@/features/planning/templates/workspace-data-unavailable-page": { WorkspaceDataUnavailablePage: () => null },
  });
  const page = await renderWorkspacePage("profile");
  expect(page.props.initialWorkspace).toBe("profile");
  expect(page.props.initialProtectedDataLoaded).toBe(true);
  expect(page.props.initialCurrentProfile).toMatchObject({ id: "synthetic-profile", platformRole: "founder" });
  expect(page.props.initialData.profiles.map(row => row.id)).toEqual(profileIds);
  expect(page.props.initialData.profiles[0]).toMatchObject({ focus: "Independent focus", weeklyCapacity: 37 });
  expectPreferences(page.props.initialData.profileUiPreferences);
  expect(page.props.initialData.notificationPreferences.map(row => row.profileId)).toEqual(profileIds);
  expect(page.props.initialData.tasks).toEqual([]);
  expectNoPlanningEnumeration();
});
