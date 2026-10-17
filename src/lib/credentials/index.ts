import type { SessionLifecycleInput, SessionCookieResponseInput, SessionPlanningInput, SessionHomeInput, SessionLinkPageInput, ServerPlanningAuth, AppWorkspace, SessionLinkPageState } from "./session-types";
import { serverPlanningAuth, serverHomeWorkspace, serverLinkPage } from "./internal/server-session-view";
import { executeSessionLifecycle } from "./internal/session-lifecycle";
import "server-only";
import { authorizeCalendar } from "./internal/session";
import type { CalendarCredentialInput, CalendarCredentialResult } from "./types";
import { authorizeLegacySession } from "./internal/legacy-session";
import type { CredentialActionInput, CredentialActionResult } from "./types";

export type { CredentialAction, CredentialActionInput, CredentialActionResult, CalendarCredentialInput, CalendarCredentialResult, CalendarReadCapability } from "./types";

export function authorizeCredentialAction(input: SessionPlanningInput): Promise<ServerPlanningAuth>;
export function authorizeCredentialAction(input: SessionHomeInput): Promise<AppWorkspace>;
export function authorizeCredentialAction(input: SessionLinkPageInput): Promise<SessionLinkPageState>;
export function authorizeCredentialAction(input: SessionCookieResponseInput): Promise<Response>;
export function authorizeCredentialAction(input: SessionLifecycleInput): Promise<Response>;
export function authorizeCredentialAction(input: CalendarCredentialInput): Promise<CalendarCredentialResult>;
export function authorizeCredentialAction(input: CredentialActionInput): Promise<CredentialActionResult>;
export function authorizeCredentialAction(input: CredentialActionInput | CalendarCredentialInput | SessionLifecycleInput | SessionCookieResponseInput | SessionPlanningInput | SessionHomeInput | SessionLinkPageInput): Promise<CredentialActionResult | CalendarCredentialResult | Response | ServerPlanningAuth | AppWorkspace | SessionLinkPageState> {
  if (input.credential.kind === "server-cookies") {
    if (input.action === "session.planning") return serverPlanningAuth();
    if (input.action === "session.home") return serverHomeWorkspace();
    if (input.action === "session.link-page") return serverLinkPage();
    return executeSessionLifecycle(input as SessionCookieResponseInput);
  }
  if (input.credential.kind === "http-request") return executeSessionLifecycle(input as SessionLifecycleInput);
  if (input.credential.kind !== "session-request") {
    return Promise.resolve({ ok: false, status: 401, error: "Anmeldung erforderlich." });
  }
  if (input.action === "calendar.read") return authorizeCalendar(input.credential.request);
  return authorizeLegacySession(input as CredentialActionInput);
}
