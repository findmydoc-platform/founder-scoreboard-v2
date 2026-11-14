import { afterEach, expect, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";

const context = vi.hoisted(() => ({ supabase: {} as unknown, authRequired: true, afterCallbacks: [] as Array<() => void>, jar: { getAll: () => [] as Array<{name:string;value:string}>, set() {} } }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-configuration", () => ({ getServerSupabase: () => context.supabase, requiresSupabaseAuth: () => context.authRequired }));
vi.mock("next/headers", () => ({ cookies: async () => context.jar, headers: async () => new Headers({ host: "localhost" }) }));
vi.mock("next/cache", () => ({ unstable_cache: (load: () => unknown) => load }));
vi.mock("next/server", async importOriginal => ({ ...await importOriginal<typeof import("next/server")>(), after: (callback: () => void) => context.afterCallbacks.push(callback) }));
vi.mock("@/features/planning/PlanningApp", () => ({ PlanningApp: () => null }));
afterEach(() => { for (const callback of context.afterCallbacks.splice(0)) callback(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); context.authRequired = true; });

function planningProtocol(notificationsUnavailable = true) {
  const protocol = administratorProtocol({ role: "founder", origin: "http://localhost:19000" });
  context.jar = protocol.cookieJar();
  const authFetch = globalThis.fetch;
  const notificationRead = vi.fn();
  const queryPlanRead = vi.fn();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/rpc/planning_source_version") return Response.json("42");
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

test("Notification Center still loads its own notification data and ready header", async () => {
  const { notificationRead } = planningProtocol(false);
  context.authRequired = true;
  const page = await renderWorkspacePage("notifications");
  expect(page.props.initialWorkspace).toBe("notifications");
  expect(page.props.initialData.notificationEvents).toEqual([]);
  expect(page.props.initialHeaderData.notifications.state).toBe("ready");
  expect(notificationRead).toHaveBeenCalled();
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
