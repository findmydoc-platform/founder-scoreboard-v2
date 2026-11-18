import { afterEach, expect, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";

const context = vi.hoisted(() => ({
  jar: { getAll: () => [] as Array<{ name: string; value: string }>, set() {} },
  afterCallbacks: [] as Array<() => void>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-configuration", () => ({ getServerSupabase: () => ({}), requiresSupabaseAuth: () => true }));
vi.mock("next/headers", () => ({ cookies: async () => context.jar, headers: async () => new Headers({ host: "localhost", "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" }) }));
vi.mock("next/cache", () => ({ unstable_cache: (load: () => unknown) => load }));
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: (callback: () => void) => context.afterCallbacks.push(callback) }));
vi.mock("@/features/planning/PlanningApp", () => ({ PlanningApp: () => null }));

import { renderWorkspacePage } from "@/app/(workspaces)/workspace-page";

afterEach(() => {
  for (const callback of context.afterCallbacks.splice(0)) callback();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

test("saved Gantt entry preserves its own preference without loading the complete workspace", async () => {
  const protocol = administratorProtocol({ role: "founder", origin: "https://gantt-startup.example.test" });
  context.jar = protocol.cookieJar();
  const authenticatedFetch = globalThis.fetch;
  const preference = {
    profile_id: "synthetic-profile", default_workspace: "planning", default_task_view: "gantt",
    planning_filters: {}, expanded_item_ids: [], created_at: "2026-11-01T12:00:00Z", updated_at: "2026-11-01T12:00:00Z",
  };
  const preferenceReads: string[] = [], completeReads: string[] = [];
  const completeTables = new Set(["active_tasks", "profiles", "sprints", "planning_item_strategy", "planning_item_raci_assignments", "task_links", "task_relationship_edges", "task_blockers"]);
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/planning_source_version") return Response.json("42");
    if (url.pathname === "/rest/v1/rpc/planning_board_publication_context") {
      const identity = await authenticatedFetch(new Request(new URL("/rest/v1/rpc/current_authenticated_profile", url), {
        method: "POST", headers: request.headers, body: "{}", signal: request.signal,
      }));
      if (!identity.ok) return identity;
      const profile: { id: string; platform_role: string } | null = await identity.json();
      return Response.json(profile ? { profile_id: profile.id, platform_role: profile.platform_role, source_revision: "42" } : null);
    }
    if (url.pathname === "/rest/v1/profile_ui_preferences") {
      preferenceReads.push(url.searchParams.get("profile_id") || "");
      return Response.json([preference], { headers: { "content-range": "0-0/1" } });
    }
    if (url.pathname === "/rest/v1/projects" && url.searchParams.get("id") === "eq.findmydoc-founder-execution") {
      return Response.json({ id: "findmydoc-founder-execution", name: "Planning", range_label: null, review_objection_window_hours: 48 });
    }
    if (url.pathname === "/rest/v1/profiles" && url.searchParams.get("id") === "eq.synthetic-profile") {
      return Response.json({ id: "synthetic-profile", name: "Synthetic Founder", platform_role: "founder", org_role: "Founder", github_login: "", deputy_for: null, deputy_active_from: null, deputy_active_until: null, focus: "", weekly_capacity: 40, profile_color: null });
    }
    if (url.pathname === "/rest/v1/rpc/planning_workspace_snapshot") {
      completeReads.push("planning_workspace_snapshot");
      return Response.json({ id: "findmydoc-founder-execution", name: "Planning", range_label: null, scope_revision: "42", active_task_count: 0, latest_updated_at: null });
    }
    const table = url.pathname.startsWith("/rest/v1/") && !url.pathname.includes("/rpc/") ? url.pathname.split("/").at(-1) : undefined;
    if (table && completeTables.has(table)) {
      completeReads.push(table);
      return Response.json([], { headers: { "content-range": "*/0" } });
    }
    // Header reconciliation owns separate reads and does not establish Gantt membership.
    if (url.pathname.startsWith("/rest/v1/") && !url.pathname.includes("/rpc/")) return Response.json([], { headers: { "content-range": "*/0" } });
    return authenticatedFetch(request);
  });

  const page = await renderWorkspacePage("planning");
  expect(page.props.initialWorkspace).toBe("planning");
  expect(page.props.initialProtectedDataLoaded).toBe(true);
  expect(page.props.initialCurrentProfile).toMatchObject({ id: "synthetic-profile", platformRole: "founder" });
  expect(preferenceReads.length).toBeGreaterThan(0);
  expect(preferenceReads.every(binding => binding === "eq.synthetic-profile")).toBe(true);
  expect(page.props.initialData.profileUiPreferences).toEqual([
    expect.objectContaining({ profileId: "synthetic-profile", defaultTaskView: "gantt" }),
  ]);
  expect(completeReads).toEqual([]);
  expect(page.props.initialWorkspaceRead?.query?.view).not.toBe("complete");
});
