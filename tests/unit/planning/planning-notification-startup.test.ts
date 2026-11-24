import { afterEach, expect, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";

const context = vi.hoisted(() => ({ supabase: {} as unknown, authRequired: true, requestHeaders: {} as Record<string, string>, afterCallbacks: [] as Array<() => void>, jar: { getAll: () => [] as Array<{name:string;value:string}>, set() {} } }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-configuration", () => ({ getServerSupabase: () => context.supabase, requiresSupabaseAuth: () => context.authRequired }));
vi.mock("next/headers", () => ({ cookies: async () => context.jar, headers: async () => new Headers({ host: "localhost", ...context.requestHeaders }) }));
vi.mock("next/cache", () => ({ unstable_cache: (load: () => unknown) => load }));
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: (callback: () => void) => context.afterCallbacks.push(callback) }));
vi.mock("@/features/planning/PlanningApp", () => ({ PlanningApp: () => null }));
afterEach(() => { for (const callback of context.afterCallbacks.splice(0)) callback(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); context.authRequired = true; context.requestHeaders = {}; });

function planningProtocol(notificationsUnavailable = true) {
  const protocol = administratorProtocol({ role: "founder", origin: "http://localhost:19000" });
  context.jar = protocol.cookieJar();
  const authFetch = globalThis.fetch;
  const notificationRead = vi.fn();
  const queryPlanRead = vi.fn();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/planning_source_version") return Response.json("42");
    if (url.pathname === "/rest/v1/rpc/planning_board_publication_context") {
      const identity = await authFetch(new Request(new URL("/rest/v1/rpc/current_authenticated_profile", url), {
        method: "POST", headers: request.headers, body: "{}", signal: request.signal,
      }));
      if (!identity.ok) return identity;
      const profile: { id: string; platform_role: string } | null = await identity.json();
      return Response.json(profile ? { profile_id: profile.id, platform_role: profile.platform_role, source_revision: "42" } : null);
    }
    if (["/rest/v1/rpc/planning_deliverable_selection", "/rest/v1/rpc/planning_deliverable_query_plan"].includes(url.pathname)) {
      const plan = url.pathname.endsWith("planning_deliverable_query_plan");
      if (plan) queryPlanRead();
      return Response.json({
      status: "ready", source_revision: "42", evaluated_at: new Date().toISOString(), temporal_key: "stable", valid_until: null,
      project: { id: "findmydoc-founder-execution", name: "Planning" }, profiles: [], sprints: [], preferences: [],
      ...(!plan ? { rows: [], card_ids: [], context_ids: [], relationships: [] } : {}),
      columns: Object.fromEntries(["Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt", "Pausiert"].map(status => [status, { total: 0, ...(plan ? { ids: [] } : {}) }])),
      metrics: { total: 0, open: 0, done: 0, blocked: 0 }, level_totals: { epic: 0, initiative: 0, deliverable: 0 }, personal_children: {}, workstreams: [], initiative_options: [], workspace_revision: { activeTaskCount: 0, latestUpdatedAt: "" },
      });
    }
    if (url.pathname === "/rest/v1/rpc/planning_deliverable_column") {
      const body = await request.json();
      if (body.p_selected_ids.length || body.p_source_revision !== "42") return Response.json({ status: "staleContinuation" });
      return Response.json({ status: "ready", source_revision: "42", evaluated_at: body.p_evaluated_at, rows: [], card_ids: [], context_ids: [], relationships: [] });
    }
    if (url.pathname === "/rest/v1/rpc/planning_workspace_snapshot") return Response.json({ id: "findmydoc-founder-execution", name: "Planning", scope_revision: "42" });
    if (url.pathname === "/rest/v1/notification_events") { notificationRead(); return notificationsUnavailable ? Response.json({ message: "Unavailable" }, { status: 503 }) : Response.json([], { headers: { "content-range": "*/0" } }); }
    if (url.pathname.startsWith("/rest/v1/") && !url.pathname.includes("/rpc/")) return Response.json([], { headers: { "content-range": "*/0" } });
    return authFetch(request);
  });
  return { protocol, notificationRead, queryPlanRead };
}
import { GET } from "@/app/api/planning-board-data/route";
import { renderWorkspacePage } from "@/app/(workspaces)/workspace-page";


test("Planning API returns the board while notification reconciliation is unavailable", async () => {
  const { protocol, notificationRead } = planningProtocol();
  const response = await GET(protocol.request("/api/planning-board-data"));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.model.project.name).toBe("Planning");
  expect(body.headerData.notifications.state).toBe("idle");
  expect(body.headerData.quickLinks.state).toBe("idle");
  expect(body.headerData.calendarEvents.state).toBe("idle");
  expect(notificationRead).not.toHaveBeenCalled();
});

test("authenticated Planning renders without waiting for the notification database", async () => {
  const { notificationRead, queryPlanRead } = planningProtocol();
  context.authRequired = true;
  const page = await renderWorkspacePage("planning");
  expect(page.props.initialData.project.name).toBe("Planning");
  expect(page.props.initialHeaderData.notifications.state).toBe("idle");
  expect(page.props.initialProtectedDataLoaded).toBe(true);
  expect(queryPlanRead).toHaveBeenCalledOnce();
  expect(context.afterCallbacks).toHaveLength(1);
  expect(notificationRead).not.toHaveBeenCalled();
});

test("local Planning without authentication retains its immediately ready empty bell", async () => {
  const { notificationRead } = planningProtocol();
  context.authRequired = false;
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("ENABLE_LOCAL_LOGIN", "true");
  try {
    const page = await renderWorkspacePage("planning");
    expect(page.props.initialHeaderData.notifications).toMatchObject({ state: "ready", data: { unreadCount: 0, items: [] } });
    expect(page.props.authRequired).toBe(false);
    expect(notificationRead).not.toHaveBeenCalled();
  } finally {
    context.authRequired = true;
  }
});

test("Notification Center admits its actor without eagerly loading Planning or claiming empty notifications", async () => {
  const { notificationRead } = planningProtocol(false);
  context.authRequired = true;
  const page = await renderWorkspacePage("notifications");
  expect(page.props.initialWorkspace).toBe("notifications");
  expect(page.props.initialData.notificationEvents).toEqual([]);
  expect(page.props.initialHeaderData.notifications.state).toBe("idle");
  expect(page.props.initialProtectedDataLoaded).toBe(true);
  expect(page.props.initialCurrentProfile).toMatchObject({ id: "synthetic-profile", platformRole: "founder" });
  expect(notificationRead).not.toHaveBeenCalled();
});

test("a direct Notification Center document reserves independent Inbox and Count before hydration", async () => {
  const { notificationRead } = planningProtocol(false);
  context.requestHeaders = { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" };
  const original = globalThis.fetch;
  const admission = vi.fn();
  const unblock: Array<() => void> = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (new URL(request.url).pathname.endsWith("/notification_publication_context")) {
      admission();
      await new Promise<void>(resolve => unblock.push(resolve));
      return Response.json({ profile_id: "synthetic-profile", platform_role: "founder", source_revision: "42" });
    }
    return original(request);
  });
  try {
    const page = await renderWorkspacePage("notifications");
    expect(page.props.initialNotificationEntry).toMatchObject({
      session: { userId: "synthetic-user" }, readAuthority: { userId: "synthetic-user" },
    });
    expect(page.props.children.props.results).toHaveProperty("inbox");
    expect(page.props.children.props.results).toHaveProperty("count");
    await vi.waitFor(() => expect(admission).toHaveBeenCalledTimes(2));
    expect(notificationRead).not.toHaveBeenCalled();
  } finally {
    context.afterCallbacks.forEach(callback => callback());
    for (const resolve of unblock) resolve();
  }
});

test.each<Record<string, string>>([
  { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "next-router-prefetch": "1" },
  { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "next-router-segment-prefetch": "segment" },
  { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", "sec-purpose": "prefetch" },
  { "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", rsc: "1" },
])("Notification Center keeps prefetch and RSC shell delivery free of content admission (%o)", async headers => {
  planningProtocol(false);
  context.requestHeaders = headers;
  const original = globalThis.fetch, notificationAdmission = vi.fn();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    if (new URL(request.url).pathname.endsWith("/notification_publication_context")) notificationAdmission();
    return original(request);
  });
  const page = await renderWorkspacePage("notifications");
  expect(page.props.initialProtectedDataLoaded).toBe(true);
  expect(page.props.initialNotificationEntry).toBeUndefined();
  expect(notificationAdmission).not.toHaveBeenCalled();
});

test("supporting workspace SSR leaves notification preview to its independent client read", async () => {
  const { notificationRead } = planningProtocol(false);
  const page = await renderWorkspacePage("events");
  expect(page.props.initialWorkspace).toBe("events");
  expect(page.props.initialHeaderData.notifications.state).toBe("idle");
  expect(notificationRead).not.toHaveBeenCalled();
});


test("Planning SSR refuses a role rebound between shell authentication and its data capability", async () => {
  const { protocol } = planningProtocol();
  const fetchProtocol = globalThis.fetch;
  let rebound = false;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init);
    const response = await fetchProtocol(request);
    if (!rebound && new URL(request.url).pathname.endsWith("/administrator_access_snapshot")) {
      rebound = true;
      protocol.state.role = "viewer";
    }
    return response;
  });
  const page = await renderWorkspacePage("planning");
  expect(rebound).toBe(true);
  expect(page.props.workspace).toBe("planning");
  expect(page.props.initialProtectedDataLoaded).toBeUndefined();
});


test.each(["projects", "events", "tools", "team", "notifications"] as const)("%s SSR refuses data rebound to another shell role", async workspace => {
  const { protocol } = planningProtocol(false), original = globalThis.fetch;
  let rebound = false;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), response = await original(request);
    if (!rebound && new URL(request.url).pathname.endsWith("/administrator_access_snapshot")) { rebound = true; protocol.state.role = "viewer"; }
    return response;
  });
  const page = await renderWorkspacePage(workspace);
  expect(rebound).toBe(true); expect(page.props.workspace).toBe(workspace);
  expect(page.props.initialProtectedDataLoaded).toBeUndefined();
});

test("Backlog SSR admits the shell without enumerating capped domain rows or certifying empty membership", async () => {
  const { protocol, notificationRead } = planningProtocol();
  const original = globalThis.fetch, broadReads: string[] = [], selfBindings: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname.startsWith("/rest/v1/") && !url.pathname.includes("/rpc/") && url.searchParams.get("limit") === "1000") broadReads.push(url.pathname);
    if (url.pathname === "/rest/v1/profiles" && url.searchParams.has("auth_user_id")) {
      selfBindings.push(url.searchParams.get("auth_user_id")!);
      return Response.json({ id: "synthetic-profile", auth_user_id: "synthetic-user", name: "Synthetic Founder", platform_role: protocol.state.role, org_role: "Founder", github_login: "", weekly_capacity: 6 });
    }
    return original(request);
  });
  const page = await renderWorkspacePage("backlog");
  expect(page.props.initialWorkspace).toBe("backlog");
  expect(broadReads).toEqual([]);
  expect(page.props.initialCurrentProfile.platformRole).toBe("founder");
  expect(page.props.initialData.tasks).toEqual([]);
  expect(selfBindings).toEqual(["eq.synthetic-user"]);
  expect(page.props.initialData.profiles).toEqual([{ id: "synthetic-profile", name: "Synthetic Founder", platformRole: "founder", orgRole: "Founder", githubLogin: "", weeklyCapacity: 6 }]);
  expect(page.props.initialBacklogModel).toMatchObject({ items: [], coverage: { items: "partial", people: "partial", sprints: "partial", commitments: "partial" } });
  expect(page.props.initialBacklogModel.selection).toBeUndefined();
  expect(page.props.initialHeaderData.notifications.state).toBe("idle");
  expect(notificationRead).not.toHaveBeenCalled();
});


test.each<{ name: string; headers: Record<string, string>; expected: number }>([
  { name: "document", headers: { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" }, expected: 1 },
  { name: "RSC soft navigation", headers: { "sec-fetch-dest": "empty", "sec-fetch-mode": "cors", rsc: "1" }, expected: 0 },
  { name: "prefetch", headers: { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate", purpose: "prefetch" }, expected: 0 },
  { name: "missing metadata", headers: {}, expected: 0 },
])("Backlog $name SSR seeds only its normalized selected query without broad supporting reads", async ({ headers, expected }) => {
  const { protocol } = planningProtocol();
  context.requestHeaders = headers;
  const selectedObservedAt = new Date().toISOString(), selectedValidUntil = new Date(Date.now() + 60_000).toISOString();
  const original = globalThis.fetch, selections: Array<{ p_filters: unknown; p_limit: number }> = [], broadReads: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname.startsWith("/rest/v1/") && !url.pathname.includes("/rpc/") && url.searchParams.get("limit") === "1000") broadReads.push(url.pathname);
    if (url.pathname === "/rest/v1/profiles" && url.searchParams.has("auth_user_id")) return Response.json({ id: "synthetic-profile", auth_user_id: "synthetic-user", name: "Synthetic Founder", platform_role: protocol.state.role, org_role: "Founder", github_login: "", weekly_capacity: 6 });
    if (url.pathname === "/rest/v1/rpc/planning_backlog_selection") {
      selections.push(await request.json());
      return Response.json({ status: "ready", item_ids: [], context_ids: [], total: 0, parent_progress_by_id: {}, rank_by_id: {},
        source_revision: "42", observed_at: selectedObservedAt, valid_until: selectedValidUntil,
        hydrated_items: [], hydrated_people: [], hydrated_sprints: [] });
    }
    return original(request);
  });
  const { default: BacklogPage } = await import("@/app/(workspaces)/backlog/page");
  const page = await BacklogPage({ searchParams: Promise.resolve({ "backlog.level": "initiative", "backlog.query": "literal%", "backlog.sort": "title", "backlog.direction": "desc", "backlog.scope": "invalid" }) });
  expect(selections).toHaveLength(expected);
  expect(broadReads).toEqual([]);
  expect(page.props.initialData.tasks).toEqual([]);
  expect(page.props.initialBacklogModel.coverage).toMatchObject({ items: "partial", people: "partial", sprints: "partial" });
  if (expected) {
    expect(selections[0]).toMatchObject({ p_filters: { level: "initiative", query: "literal%", sort: "title", direction: "desc", scope: "all" }, p_limit: 20 });
    expect(page.props.initialBacklogRead).toMatchObject({ session: { userId: "synthetic-user" }, read: {
      readActor: { profileId: "synthetic-profile", platformRole: "founder" }, readAuthority: { userId: "synthetic-user" },
      backlogSelection: { total: 0, itemIds: [], contextIds: [], sourceRevision: "42" },
    } });
    expect(page.props.initialBacklogRead.read.readAuthority.deadline).toBeLessThanOrEqual(page.props.initialBacklogRead.session.expiresAt * 1000);
    expect(page.props.initialBacklogRead.read.readAuthority.deadline).toBeGreaterThan(Date.now());
    expect(page.props.initialBacklogRead.read.backlogSelection).toMatchObject({ observedAt: selectedObservedAt, validUntil: selectedValidUntil });
  } else expect(page.props.initialBacklogRead).toBeUndefined();
});
