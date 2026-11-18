import { Children, isValidElement } from "react";
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

for (const boundary of ["current", "source", "actor", "deadline"] as const) {
  test(`Team SSR preserves its People publication fence and independent Header delivery after ${boundary}`, async () => {
    const originalNow = Date.now();
    const expiry = Math.floor(originalNow / 1000) + 3600;
    const protocol = administratorProtocol({ role: "ceo", origin: "https://team-ssr-cost.example.test", claims: { exp: expiry } });
    context.jar = protocol.cookieJar();
    const authenticatedFetch = globalThis.fetch;
    const paths: string[] = [];
    const publications: Array<{ source: string; role: string }> = [];
    let source = "42";
    let enterHeader!: () => void, enterDirectory!: () => void, releaseHeader!: () => void;
    const headerEntered = new Promise<void>(resolve => { enterHeader = resolve; });
    const directoryEntered = new Promise<void>(resolve => { enterDirectory = resolve; });
    const headerGate = new Promise<void>(resolve => { releaseHeader = resolve; });
    const people = [
      { id: "synthetic-profile", name: "Synthetic CEO", platform_role: "ceo", org_role: "CEO", github_login: "", focus: "", weekly_capacity: 40 },
      { id: "synthetic-founder", name: "Synthetic Founder", platform_role: "founder", org_role: "Operations", github_login: "", focus: "Delivery", weekly_capacity: 37 },
    ];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init), url = new URL(request.url);
      paths.push(url.pathname);
      if (url.pathname === "/rest/v1/rpc/planning_board_publication_context") {
        const identity = await authenticatedFetch(new Request(new URL("/rest/v1/rpc/current_authenticated_profile", url), { method: "POST", headers: request.headers, body: "{}", signal: request.signal }));
        if (!identity.ok) return identity;
        const profile: { id: string; platform_role: string } | null = await identity.json();
        publications.push({ source, role: profile?.platform_role || "" });
        return Response.json(profile ? { profile_id: profile.id, platform_role: profile.platform_role, source_revision: source } : null);
      }
      if (url.pathname === "/rest/v1/profiles") {
        enterDirectory();
        await headerGate;
        return Response.json(people, { headers: { "content-range": "0-1/2" } });
      }
      if (url.pathname === "/rest/v1/fmd_tools") {
        enterHeader();
        return Response.json([{ id: "fixture-link", name: "Fixture handbook", category: "General", url: "https://example.test/handbook", preview_image_url: null }]);
      }
      if (url.pathname === "/rest/v1/founder_events") return Response.json([{ id: 1, title: "Fixture event", category: "meeting", starts_at: "2026-11-19T10:00:00Z", ends_at: "2026-11-19T11:00:00Z", location: "", status: "planned" }]);
      if (url.pathname.startsWith("/rest/v1/") && !url.pathname.includes("/rpc/")) return Response.json([], { headers: { "content-range": "*/0" } });
      return authenticatedFetch(request);
    });
    let settled = false;
    const rendering = renderWorkspacePage("team").then(page => { settled = true; return page; });
    let restoreClock: (() => void) | undefined;
    try {
      await Promise.race([Promise.all([headerEntered, directoryEntered]), rendering.then(() => { throw new Error("SSR returned before the held directory read"); })]);
      expect(settled).toBe(false);
      if (boundary === "source") source = "43";
      if (boundary === "actor") protocol.state.role = "viewer";
      if (boundary === "deadline") {
        const clock = vi.spyOn(Date, "now").mockReturnValue(expiry * 1000 + 1);
        restoreClock = () => clock.mockRestore();
      }
      releaseHeader();
      const page = await rendering;
      expect(paths.filter(path => path.startsWith("/api/"))).toEqual([]);
      if (boundary !== "current") {
        expect(page.props).not.toHaveProperty("initialData");
        expect(page.props).not.toHaveProperty("initialWorkspaceRead");
        return;
      }
      expect(page.props.initialProtectedDataLoaded).toBe(true);
      expect(page.props.initialCurrentProfile).toMatchObject({ id: "synthetic-profile", platformRole: "ceo" });
      expect(page.props.initialData.profiles).toHaveLength(2);
      expect(page.props.initialData.profiles.find((person: { id: string }) => person.id === "synthetic-founder")).toMatchObject({
        name: "Synthetic Founder", orgRole: "Operations", weeklyCapacity: 37, focus: "Delivery",
        persistenceBasis: { platform_role: "founder", org_role: "Operations", weekly_capacity: 37 },
      });
      expect(page.props.initialData.tasks).toEqual([]);
      expect(page.props.initialWorkspaceRead).toMatchObject({ workspace: "team", scopeRevision: "42", coverage: { profiles: "complete", tasks: "partial" }, readAuthority: { deadline: expiry * 1000 } });
      const delivery = Children.toArray(page.props.children).find(child => isValidElement(child) && child.type === PlanningServerHeaderSlots);
      if (!isValidElement<{ read: PlanningServerHeaderRead; results: Record<PlanningServerHeaderSlot, Promise<PlanningServerHeaderResult>> }>(delivery)) throw new Error("Reserved Header delivery missing");
      expect(delivery.props.read).toMatchObject({ userId: page.props.initialWorkspaceRead.session.userId, sessionRevision: page.props.initialWorkspaceRead.session.revision, deadline: expiry * 1000 });
      const [links, calendar] = await Promise.all([delivery.props.results.quickLinks, delivery.props.results.calendarEvents]);
      expect(links.headerData.quickLinks).toMatchObject({ state: "ready", data: [expect.objectContaining({ id: "fixture-link", name: "Fixture handbook" })] });
      expect(calendar.headerData.calendarEvents).toMatchObject({ state: "ready", data: [expect.objectContaining({ title: "Fixture event" })] });
      expect(page.props.initialHeaderData.notifications.state).toBe("idle");
      // This RPC is used only by the People source/publication fences; Header slots perform separate data reads.
      expect(publications).toEqual([{ source: "42", role: "ceo" }, { source: "42", role: "ceo" }]);
    } finally {
      releaseHeader();
      await rendering;
      restoreClock?.();
    }
  });
}
