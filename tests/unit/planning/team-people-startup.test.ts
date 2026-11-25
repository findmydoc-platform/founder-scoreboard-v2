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

test("direct Team entry renders its people and CEO editing basis when Planning enumeration fails", async () => {
  const protocol = administratorProtocol({ role: "ceo", origin: "https://team-startup.example.test" });
  context.jar = protocol.cookieJar();
  const authenticatedFetch = globalThis.fetch;
  const planningReads: string[] = [];
  const planningTables = new Set(["active_tasks", "planning_item_strategy", "planning_item_raci_assignments", "task_links"]);
  const people = [
    { id: "synthetic-profile", name: "Synthetic CEO", platform_role: "ceo", org_role: "CEO", github_login: "", deputy_for: null, deputy_active_from: null, deputy_active_until: null, focus: "", weekly_capacity: 40, profile_color: null },
    { id: "synthetic-founder", name: "Synthetic Founder", platform_role: "founder", org_role: "Founder", github_login: "", deputy_for: null, deputy_active_from: null, deputy_active_until: null, focus: "", weekly_capacity: 37, profile_color: null },
  ];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/planning_source_version") return Response.json("42");
    if (url.pathname === "/rest/v1/rpc/planning_board_publication_context") {
      const identity = await authenticatedFetch(new Request(new URL("/rest/v1/rpc/current_authenticated_profile", url), { method: "POST", headers: request.headers, body: "{}", signal: request.signal }));
      if (!identity.ok) return identity;
      const profile: { id: string; platform_role: string } | null = await identity.json();
      return Response.json(profile ? { profile_id: profile.id, platform_role: profile.platform_role, source_revision: "42" } : null);
    }
    if (url.pathname === "/rest/v1/profiles") return Response.json(people, { headers: { "content-range": "0-1/2" } });
    const table = url.pathname.startsWith("/rest/v1/") && !url.pathname.includes("/rpc/") ? url.pathname.split("/").at(-1) : undefined;
    if (table && planningTables.has(table)) { planningReads.push(table); return Response.json({ message: "Planning enumeration unavailable" }, { status: 503 }); }
    if (url.pathname.startsWith("/rest/v1/") && !url.pathname.includes("/rpc/")) return Response.json([], { headers: { "content-range": "*/0" } });
    return authenticatedFetch(request);
  });

  const page = await renderWorkspacePage("team");
  expect(planningReads).toEqual([]);
  expect(page.props.initialWorkspace).toBe("team");
  expect(page.props.initialProtectedDataLoaded).toBe(true);
  expect(page.props.initialCurrentProfile).toMatchObject({ id: "synthetic-profile", platformRole: "ceo" });
  expect(page.props.initialData.profiles).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: "synthetic-profile", platformRole: "ceo" }),
    expect.objectContaining({ id: "synthetic-founder", name: "Synthetic Founder", weeklyCapacity: 37, persistenceBasis: expect.objectContaining({ platform_role: "founder", weekly_capacity: 37 }) }),
  ]));
  expect(page.props.initialHeaderData).toBeDefined();
  expect(page.props.initialWorkspaceRead).toMatchObject({ workspace: "team", queryKey: "workspace", scopeRevision: "42", coverage: { profiles: "complete", tasks: "partial" }, readAuthority: { userId: expect.any(String), deadline: expect.any(Number) }, session: { revision: expect.any(String) } });
});
