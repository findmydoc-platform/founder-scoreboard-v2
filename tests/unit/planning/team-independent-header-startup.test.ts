import { Children, isValidElement } from "react";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { PlanningServerHeaderSlots } from "@/features/planning/server/planning-server-header-slots";
import type { PlanningServerHeaderRead, PlanningServerHeaderResult, PlanningServerHeaderSlot } from "@/features/planning/model/planning-server-header-read";
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

test("Team SSR exposes complete editable People and permits Metrics while both reserved Header slots are held", async () => {
  const protocol = administratorProtocol({ role: "ceo", origin: "https://team-independent-header.example.test" });
  context.jar = protocol.cookieJar();
  const transport = globalThis.fetch;
  let release!: () => void, reachedLinks!: () => void, reachedCalendar!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const linksEntered = new Promise<void>(resolve => { reachedLinks = resolve; });
  const calendarEntered = new Promise<void>(resolve => { reachedCalendar = resolve; });
  const dataReads: string[] = [];
  const people = [
    { id: "synthetic-profile", name: "Synthetic CEO", platform_role: "ceo", org_role: "CEO", focus: "", weekly_capacity: 40 },
    { id: "synthetic-founder", name: "Independent member", platform_role: "founder", org_role: "Operations", focus: "Delivery", weekly_capacity: 37 },
  ];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/planning_board_publication_context") {
      const response = await transport(new Request(new URL("/rest/v1/rpc/current_authenticated_profile", url), { method: "POST", headers: request.headers, body: "{}", signal: request.signal }));
      if (!response.ok) return response;
      const actor = await response.json();
      return Response.json(actor ? { profile_id: actor.id, platform_role: actor.platform_role, source_revision: "42" } : null);
    }
    if (url.pathname === "/rest/v1/profiles") {
      dataReads.push("people");
      return Response.json(people, { headers: { "content-range": "0-1/2" } });
    }
    if (url.pathname === "/rest/v1/fmd_tools") {
      dataReads.push("quickLinks"); reachedLinks(); await gate;
      return Response.json([{ id: "handbook", name: "Team handbook", category: "tool", url: "https://example.test/handbook", preview_image_url: null }]);
    }
    if (url.pathname === "/rest/v1/founder_events") {
      dataReads.push("calendarEvents"); reachedCalendar(); await gate;
      return Response.json([{ id: 1, title: "Team meeting", category: "meeting", starts_at: "2026-11-19T10:00:00Z", ends_at: "2026-11-19T11:00:00Z", location: "", status: "planned" }]);
    }
    if (url.pathname.startsWith("/rest/v1/") && !url.pathname.includes("/rpc/")) return Response.json([], { headers: { "content-range": "*/0" } });
    return transport(request);
  });
  let page: Awaited<ReturnType<typeof renderWorkspacePage>> | undefined;
  const rendering = renderWorkspacePage("team").then(result => { page = result; return result; });
  let owner: ReturnType<typeof createPlanningState> | undefined;
  try {
    await Promise.race([Promise.all([linksEntered, calendarEntered]), rendering.then(() => { throw new Error("Both Header slots must actually start"); })]);
    // Both data responses are still held. Only an independently publishable Team page can satisfy this.
    await vi.waitFor(() => expect(page).toBeDefined());
    if (!page) throw new Error("Team page unavailable independently of Header");
    const props = page.props;
    expect(props.initialProtectedDataLoaded).toBe(true);
    expect(props.initialData.profiles).toHaveLength(2);
    expect(props.initialWorkspaceRead).toMatchObject({ workspace: "team", scopeRevision: "42", coverage: { profiles: "complete", tasks: "partial" } });
    expect(props.initialServerHeaderRead).toMatchObject({ userId: props.initialWorkspaceRead.session.userId, sessionRevision: props.initialWorkspaceRead.session.revision, deadline: props.initialWorkspaceRead.readAuthority.deadline });
    const children = Children.toArray(props.children);
    const delivery = children.find(child => isValidElement(child) && child.type === PlanningServerHeaderSlots);
    if (!isValidElement<{ read: PlanningServerHeaderRead; results: Record<PlanningServerHeaderSlot, Promise<PlanningServerHeaderResult>> }>(delivery)) throw new Error("Existing reserved Header slot transport missing");
    let metricReads = 0, browserHeaderReads = 0, browserPeopleReads = 0;
    owner = createPlanningState({ userId: props.initialWorkspaceRead.session.userId, initialWorkspace: "team", initialSession: props.initialWorkspaceRead.session,
      initialWorkspaceRead: props.initialWorkspaceRead, initialData: props.initialData, initialCurrentProfile: props.initialCurrentProfile,
      initialServerHeaderRead: props.initialServerHeaderRead, initialHeaderData: props.initialHeaderData, adapter: {
        saveTask: async () => ({ task: {} }),
        readWorkspace: async () => { browserPeopleReads++; return null; },
        readHeader: async () => { browserHeaderReads++; throw new Error("Reserved Header must not refetch"); },
        readTeamMetrics: async () => {
          metricReads++;
          return { model: { revision: "42", scopeRevision: "42", observedAt: new Date().toISOString(), validUntil: null, coverage: "complete" as const, metricsByProfileId: {
            "synthetic-profile": { openTasks: 0, highPriorityTasks: 0, loadHours: 0 }, "synthetic-founder": { openTasks: 3, highPriorityTasks: 1, loadHours: 9 },
          } }, currentProfile: props.initialCurrentProfile, readAuthority: props.initialWorkspaceRead.readAuthority };
        },
      } });
    const member = owner.planning.team().profiles.find(person => person.id === "synthetic-founder");
    expect(member).toMatchObject({ weeklyCapacity: 37, persistenceBasis: { weekly_capacity: 37, org_role: "Operations" } });
    if (!member) throw new Error("Complete editable member missing");
    expect(owner.planning.beginTeamProfileEdit(member).view().phase).toBe("editing");
    expect(await owner.planning.loadTeamMetrics()).toBe(true);
    expect(metricReads).toBe(1);
    expect(owner.planning.header().slots.quickLinks.readStatus).toBe("loading");
    expect(owner.planning.header().slots.calendarEvents.readStatus).toBe("loading");
    release();
    for (const slot of ["quickLinks", "calendarEvents"] as const) {
      const result = await delivery.props.results[slot];
      expect(owner.planning.acceptServerHeaderSlot(delivery.props.read, slot, result.headerData)).toBe(true);
    }
    expect(owner.planning.header().data.quickLinks.data).toEqual([expect.objectContaining({ name: "Team handbook" })]);
    expect(owner.planning.header().data.calendarEvents.data).toEqual([expect.objectContaining({ title: "Team meeting" })]);
    expect(browserPeopleReads).toBe(0); expect(browserHeaderReads).toBe(0);
    expect(dataReads.sort()).toEqual(["calendarEvents", "people", "quickLinks"]);
  } finally { release(); await rendering; owner?.internal.dispose(); }
});
