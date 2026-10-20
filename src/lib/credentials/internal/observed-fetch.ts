import "server-only";
import { calendarObservationActive, observeCalendarHttp } from "../../runtime-logging";
import type { SafeOperation } from "../../runtime-logging/output";

// Classification is private and finite. No input URL or credential enters telemetry.
export const observedSupabaseFetch: typeof fetch = (input, init) => {
  if (!calendarObservationActive()) return fetch(input, init);
  let operation: SafeOperation = "supabase.other";
  try {
    const pathname = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url).pathname;
    if (pathname === "/auth/v1/.well-known/jwks.json") operation = "supabase.jwks";
    else if (pathname === "/auth/v1/user") operation = "supabase.user";
    else if (pathname === "/auth/v1/token") operation = "supabase.refresh";
    else if (pathname === "/auth/v1/settings") operation = "supabase.settings";
    else if (pathname === "/rest/v1/rpc/workspace_access_context") operation = "workspace.context";
    else if (["/rest/v1/rpc/workspace_session_allowed", "/rest/v1/rpc/workspace_linking_session_allowed"].includes(pathname)) operation = "workspace.session";
    else if (pathname === "/rest/v1/rpc/workspace_issue_permit") operation = "workspace.permit.issue";
    else if (pathname === "/rest/v1/rpc/workspace_release_permit") operation = "workspace.permit.release";
    else if (pathname === "/rest/v1/rpc/current_authenticated_profile") operation = "calendar.profile";
    else if (pathname === "/rest/v1/team_workweek_publications") operation = "calendar.publications";
  } catch { /* An unrecognized attempt lowers coverage without leaking its input. */ }
  if (!calendarObservationActive()) return fetch(input, init);
  return observeCalendarHttp(operation, () => fetch(input, init));
};

export function observedDirectoryFetch(operation: "directory.sts" | "directory.iam" | "directory.membership", input: string, init: RequestInit): Promise<Response> {
  if (!calendarObservationActive()) return fetch(input, init);
  return observeCalendarHttp(operation, () => fetch(input, init));
}
