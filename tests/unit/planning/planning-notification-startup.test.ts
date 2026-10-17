import { afterEach, expect, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";

const context = vi.hoisted(() => ({ supabase: {} as unknown, authRequired: true, jar: { getAll: () => [] as Array<{name:string;value:string}>, set() {} } }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", () => ({ getServerSupabase: () => context.supabase, requiresSupabaseAuth: () => context.authRequired }));
vi.mock("next/headers", () => ({ cookies: async () => context.jar, headers: async () => new Headers({ host: "localhost" }) }));
vi.mock("next/cache", () => ({ unstable_cache: (load: () => unknown) => load }));
vi.mock("@/features/planning/PlanningApp", () => ({ PlanningApp: () => null }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); context.authRequired = true; });

function planningProtocol() {
  const protocol = administratorProtocol({ role: "founder", origin: "http://localhost:19000" });
  context.jar = protocol.cookieJar();
  const authFetch = globalThis.fetch;
  const notificationRead = vi.fn();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/projects") return Response.json({ id: "findmydoc-founder-execution", name: "Planning" });
    if (url.pathname === "/rest/v1/notification_events") { notificationRead(); return Response.json({ message: "Unavailable" }, { status: 503 }); }
    if (url.pathname.startsWith("/rest/v1/") && !url.pathname.includes("/rpc/")) return Response.json([]);
    return authFetch(request);
  });
  return { protocol, notificationRead };
}
import { GET } from "@/app/api/planning-board-data/route";
import { renderWorkspacePage } from "@/app/(workspaces)/workspace-page";

function database(notificationsUnavailable = true) {
  const notificationRead = vi.fn();
  const supabase = {
    from(table: string) {
      const query = {
        select() { return query; }, eq() { return query; }, order() { return query; },
        limit() { return query; }, not() { return query; }, neq() { return query; },
        gt() { return query; }, or() { return query; }, is() { return query; },
        single() { return Promise.resolve({ data: { id: "project", name: "Planning" }, error: null }); },
        then(resolve: (value: unknown) => unknown) {
          if (table === "notification_events") notificationRead();
          if (table === "notification_events" && notificationsUnavailable) {
            return Promise.resolve(resolve({ data: null, error: { message: "Notifications unavailable" } }));
          }
          return Promise.resolve(resolve({ data: [], error: null }));
        },
      };
      return query;
    },
  };
  return { supabase, notificationRead };
}

test("Planning API returns the board while notification reconciliation is unavailable", async () => {
  const { protocol, notificationRead } = planningProtocol();
  const response = await GET(protocol.request("/api/planning-board-data"));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.model.project.name).toBe("Planning");
  expect(body.headerData.notifications.state).toBe("idle");
  expect(body.headerData.quickLinks.state).toBe("ready");
  expect(body.headerData.calendarEvents.state).toBe("ready");
  expect(notificationRead).not.toHaveBeenCalled();
});

test("authenticated Planning renders without waiting for the notification database", async () => {
  const { notificationRead } = planningProtocol();
  context.authRequired = true;
  const page = await renderWorkspacePage("planning");
  expect(page.props.initialData.project.name).toBe("Planning");
  expect(page.props.initialHeaderData.notifications.state).toBe("idle");
  expect(page.props.initialProtectedDataLoaded).toBe(true);
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
  planningProtocol();
  const { supabase, notificationRead } = database(false);
  context.supabase = supabase;
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
