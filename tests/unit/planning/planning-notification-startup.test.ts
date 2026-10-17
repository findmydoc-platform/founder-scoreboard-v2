import { afterEach, expect, test, vi } from "vitest";
import { administratorProtocol } from "../../helpers/administrator-protocol.mjs";

const context = vi.hoisted(() => ({ supabase: {} as unknown, authRequired: true, jar: { getAll: () => [] as Array<{name:string;value:string}>, set() {} } }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase-configuration", () => ({ getServerSupabase: () => context.supabase, requiresSupabaseAuth: () => context.authRequired }));
vi.mock("next/headers", () => ({ cookies: async () => context.jar, headers: async () => new Headers({ host: "localhost" }) }));
vi.mock("next/cache", () => ({ unstable_cache: (load: () => unknown) => load }));
vi.mock("@/features/planning/PlanningApp", () => ({ PlanningApp: () => null }));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); context.authRequired = true; });

function planningProtocol(notificationsUnavailable = true) {
  const protocol = administratorProtocol({ role: "founder", origin: "http://localhost:19000" });
  context.jar = protocol.cookieJar();
  const authFetch = globalThis.fetch;
  const notificationRead = vi.fn();
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init), url = new URL(request.url);
    if (url.pathname === "/rest/v1/projects") return Response.json({ id: "findmydoc-founder-execution", name: "Planning" });
    if (url.pathname === "/rest/v1/notification_events") { notificationRead(); return notificationsUnavailable ? Response.json({ message: "Unavailable" }, { status: 503 }) : Response.json([]); }
    if (url.pathname.startsWith("/rest/v1/") && !url.pathname.includes("/rpc/")) return Response.json([]);
    return authFetch(request);
  });
  return { protocol, notificationRead };
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
