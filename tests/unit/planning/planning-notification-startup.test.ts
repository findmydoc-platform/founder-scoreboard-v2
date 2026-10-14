import { expect, test, vi } from "vitest";
import { NextRequest } from "next/server";

const context = vi.hoisted(() => ({ profile: { id: "founder", platformRole: "founder" }, supabase: {} as unknown, authRequired: true }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/api-response", () => ({
  requireApiContext: async () => ({ ok: true, permission: { profile: context.profile }, supabase: context.supabase }),
  apiError: (error: string, status: number) => Response.json({ error }, { status }),
}));
vi.mock("@/lib/planning-header-cache", () => ({ sharedPlanningHeaderSlotLoaders: {} }));
vi.mock("@/lib/supabase", () => ({ getServerSupabase: () => context.supabase, requiresSupabaseAuth: () => context.authRequired }));
vi.mock("@/lib/planning-auth-server", () => ({ getServerPlanningAuth: async () => ({ ok: true, profile: context.profile, user: { id: "auth-user" } }) }));
vi.mock("@/features/planning/PlanningApp", () => ({ PlanningApp: () => null }));
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
  const { supabase, notificationRead } = database();
  context.supabase = supabase;
  const response = await GET(new NextRequest("http://localhost:3000/api/planning-board-data"));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.model.project.name).toBe("Planning");
  expect(body.headerData.notifications.state).toBe("idle");
  expect(body.headerData.quickLinks.state).toBe("ready");
  expect(body.headerData.calendarEvents.state).toBe("ready");
  expect(notificationRead).not.toHaveBeenCalled();
});

test("authenticated Planning renders without waiting for the notification database", async () => {
  const { supabase, notificationRead } = database();
  context.supabase = supabase;
  context.authRequired = true;
  const page = await renderWorkspacePage("planning");
  expect(page.props.initialData.project.name).toBe("Planning");
  expect(page.props.initialHeaderData.notifications.state).toBe("idle");
  expect(page.props.initialProtectedDataLoaded).toBe(true);
  expect(notificationRead).not.toHaveBeenCalled();
});

test("local Planning without authentication retains its immediately ready empty bell", async () => {
  const { supabase, notificationRead } = database();
  context.supabase = supabase;
  context.authRequired = false;
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
  const { supabase, notificationRead } = database(false);
  context.supabase = supabase;
  context.authRequired = true;
  const page = await renderWorkspacePage("notifications");
  expect(page.props.initialWorkspace).toBe("notifications");
  expect(page.props.initialData.notificationEvents).toEqual([]);
  expect(page.props.initialHeaderData.notifications.state).toBe("ready");
  expect(notificationRead).toHaveBeenCalled();
});
