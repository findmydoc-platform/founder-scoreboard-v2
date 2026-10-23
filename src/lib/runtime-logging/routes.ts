// Static identifiers only. Request paths select a reviewed entry but never enter output.
export const runtimeRoutes = {
  "calendar.team": { scope: "calendar", method: "GET", route: "/api/team-workweek/team" },
  "planning.header": { scope: "planning", method: "GET", route: "/api/planning-header-data" },
  "planning.board": { scope: "planning", method: "GET", route: "/api/planning-board-data" },
  "planning.revision": { scope: "planning", method: "GET", route: "/api/planning-revision" },
  "planning.sprint": { scope: "planning", method: "GET", route: "/api/sprint-data" },
  "planning.strategic": { scope: "planning", method: "GET", route: "/api/strategic-planning-data" },
  "task.detail": { scope: "planning", method: "GET", route: "/api/tasks/[id]/detail-data" },
  "task.comment": { scope: "planning", method: "POST", route: "/api/tasks/[id]/comments" },
  "task.github-comments": { scope: "github", method: "POST", route: "/api/tasks/[id]/github-comments" },
  "task.github-sync": { scope: "github", method: "POST", route: "/api/tasks/[id]/sync-github" },
  "github.status": { scope: "github", method: "GET", route: "/api/github-app/status" },
  "github.disconnect": { scope: "github", method: "DELETE", route: "/api/github-app/connection" },
  "workweek.draft.read": { scope: "workweek", method: "GET", route: "/api/team-workweek/private-draft" },
  "workweek.draft.write": { scope: "workweek", method: "POST", route: "/api/team-workweek/private-draft" },
  "workweek.publish": { scope: "workweek", method: "POST", route: "/api/team-workweek/publish" },
  "workweek.reconcile": { scope: "workweek", method: "POST", route: "/api/team-workweek/reconcile" },
  "workweek.restart": { scope: "workweek", method: "POST", route: "/api/team-workweek/restart" },
  "workweek.conflict.read": { scope: "workweek", method: "GET", route: "/api/team-workweek/conflict" },
  "workweek.conflict.resolve": { scope: "workweek", method: "POST", route: "/api/team-workweek/conflict" },
  "google.status": { scope: "workweek", method: "GET", route: "/api/google-workspace/status" },
  "google.disconnect.preview": { scope: "workweek", method: "GET", route: "/api/google-workspace/disconnect" },
  "google.disconnect": { scope: "workweek", method: "POST", route: "/api/google-workspace/disconnect" },
  "notifications.read": { scope: "notifications", method: "GET", route: "/api/notifications-data" },
  "notifications.delivery.inspect": { scope: "notifications", method: "GET", route: "/api/notifications/deliver" },
  "notifications.delivery.run": { scope: "notifications", method: "POST", route: "/api/notifications/deliver" },
} as const;
export type RuntimeRouteKey = keyof typeof runtimeRoutes;
export function runtimeRoute(value: unknown) {
  return typeof value === "string" && Object.hasOwn(runtimeRoutes, value) ? runtimeRoutes[value as RuntimeRouteKey] : undefined;
}
export function matchRuntimeRoute(method: string, pathname: string): RuntimeRouteKey | undefined {
  return (Object.keys(runtimeRoutes) as RuntimeRouteKey[]).find(key => {
    const entry = runtimeRoutes[key];
    return entry.method === method && new RegExp(`^${entry.route.replace("[id]", "[^/]+")}$`).test(pathname);
  });
}
