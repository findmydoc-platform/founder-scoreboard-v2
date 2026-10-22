import "server-only";
import { runtimeObservationActive, observeProviderHttp, runtimeObservationScope } from "../../runtime-logging";
import type { SafeOperation } from "../../runtime-logging/output";

// Classification is private and finite. No input URL or credential enters telemetry.
export const observedSupabaseFetch: typeof fetch = (input, init) => {
  if (!runtimeObservationActive()) return fetch(input, init);
  let operation: SafeOperation = "supabase.other";
  try {
    const method = (init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    const calendar = runtimeObservationScope() === "calendar";
    const pathname = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname;
    if (pathname === "/auth/v1/.well-known/jwks.json") operation = "supabase.jwks";
    else if (pathname === "/auth/v1/user") operation = "supabase.user";
    else if (pathname === "/auth/v1/token") operation = "supabase.refresh";
    else if (pathname === "/auth/v1/settings") operation = "supabase.settings";
    else if (pathname === "/rest/v1/rpc/workspace_access_context") operation = "workspace.context";
    else if (pathname === "/rest/v1/rpc/workspace_calendar_entry") operation = "workspace.entry";
    else if (["/rest/v1/rpc/workspace_session_allowed", "/rest/v1/rpc/workspace_linking_session_allowed"].includes(pathname)) operation = "workspace.session";
    else if (pathname === "/rest/v1/rpc/workspace_calendar_prepare") operation = "workspace.dispatch.prepare";
    else if (pathname === "/rest/v1/rpc/workspace_issue_permit") operation = "workspace.permit.issue";
    else if (pathname === "/rest/v1/rpc/workspace_release_permit") operation = "workspace.permit.release";
    else if (pathname === "/rest/v1/rpc/current_authenticated_profile") operation = calendar ? "calendar.profile" : "supabase.db.identity.rpc";
    else if (pathname === "/rest/v1/profiles" && calendar) operation = "calendar.snapshot";
    else if (pathname === "/rest/v1/team_workweek_publications" && calendar) operation = "calendar.publications";
    else if (pathname.startsWith("/auth/v1/")) operation = "supabase.auth.other";
    else if (pathname.startsWith("/rest/v1/rpc/")) operation = "supabase.db.rpc";
    else if (pathname.startsWith("/rest/v1/")) {
      const read = method === "GET" || method === "HEAD";
      if (["/rest/v1/tasks", "/rest/v1/task_comments", "/rest/v1/task_dependencies", "/rest/v1/sprints", "/rest/v1/sprint_commitments"].includes(pathname)) operation = read ? "supabase.db.planning.read" : "supabase.db.planning.write";
      else if (["/rest/v1/profiles", "/rest/v1/github_app_user_tokens", "/rest/v1/google_workspace_connections"].includes(pathname)) operation = read ? "supabase.db.identity.read" : "supabase.db.identity.write";
      else operation = read ? "supabase.db.read" : "supabase.db.write";
    }
  } catch { /* An unrecognized attempt lowers coverage without leaking its input. */ }
  if (!runtimeObservationActive()) return fetch(input, init);
  return observeProviderHttp(operation, () => fetch(input, init));
};

export function observedDirectoryFetch(operation: "directory.sts" | "directory.iam" | "directory.membership", input: string, init: RequestInit): Promise<Response> {
  if (!runtimeObservationActive()) return fetch(input, init);
  return observeProviderHttp(operation, () => fetch(input, init));
}


export function observedProviderFetch(operation: SafeOperation, input: RequestInfo | URL, init?: RequestInit, allowedStatuses?: readonly number[]): Promise<Response> {
  if (!runtimeObservationActive()) return fetch(input, init);
  return observeProviderHttp(operation, () => fetch(input, init), allowedStatuses);
}
