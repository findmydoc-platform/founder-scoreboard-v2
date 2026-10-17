import "server-only";
import { authorizeCalendar } from "./internal/session";
import type { CalendarCredentialInput, CalendarCredentialResult } from "./types";
import { authorizeLegacySession } from "./internal/legacy-session";
import type { CredentialActionInput, CredentialActionResult } from "./types";

export type { CredentialAction, CredentialActionInput, CredentialActionResult, CalendarCredentialInput, CalendarCredentialResult, CalendarReadCapability } from "./types";

export function authorizeCredentialAction(input: CalendarCredentialInput): Promise<CalendarCredentialResult>;
export function authorizeCredentialAction(input: CredentialActionInput): Promise<CredentialActionResult>;
export function authorizeCredentialAction(input: CredentialActionInput | CalendarCredentialInput): Promise<CredentialActionResult | CalendarCredentialResult> {
  if (input.credential.kind !== "session-request") {
    return Promise.resolve({ ok: false, status: 401, error: "Anmeldung erforderlich." });
  }
  if (input.action === "calendar.read") return authorizeCalendar(input.credential.request);
  return authorizeLegacySession(input);
}
