import { authorizePersonalPlanning, authorizePersonalPlanningTokenManagement } from "./internal/personal-planning";
import type { PersonalPlanningCredentialInput, PersonalPlanningCredentialResult, PersonalPlanningTokenManagementInput, PersonalPlanningTokenManagementResult } from "./types";
import { authorizePrivateDraft } from "./internal/private-draft";
import type { PrivateDraftCredentialInput, PrivateDraftCredentialResult, PrivateDraftReadResult, PrivateDraftWriteResult } from "./types";
import "server-only";
import { authorizeCalendar } from "./internal/session";
import type { CalendarCredentialInput, CalendarCredentialResult } from "./types";
import { authorizeLegacySession } from "./internal/legacy-session";
import type { CredentialActionInput, CredentialActionResult } from "./types";

export type { CredentialAction, CredentialActionInput, CredentialActionResult, CalendarCredentialInput, CalendarCredentialResult, CalendarReadCapability } from "./types";

export function authorizeCredentialAction(input: PersonalPlanningTokenManagementInput): Promise<PersonalPlanningTokenManagementResult>;
export function authorizeCredentialAction(input: PersonalPlanningCredentialInput): Promise<PersonalPlanningCredentialResult>;
export function authorizeCredentialAction(input: PrivateDraftCredentialInput & {action: "workweek.private.read"}): Promise<PrivateDraftReadResult>;
export function authorizeCredentialAction(input: PrivateDraftCredentialInput & {action: "workweek.private.write"}): Promise<PrivateDraftWriteResult>;
export function authorizeCredentialAction(input: CalendarCredentialInput): Promise<CalendarCredentialResult>;
export function authorizeCredentialAction(input: CredentialActionInput): Promise<CredentialActionResult>;
export function authorizeCredentialAction(input: CredentialActionInput | CalendarCredentialInput | PrivateDraftCredentialInput | PersonalPlanningCredentialInput | PersonalPlanningTokenManagementInput): Promise<CredentialActionResult | CalendarCredentialResult | PrivateDraftCredentialResult | PersonalPlanningCredentialResult | PersonalPlanningTokenManagementResult> {
  if (input.credential.kind === "personal-planning-token") return authorizePersonalPlanning(input as PersonalPlanningCredentialInput);
  if (input.credential.kind !== "session-request") {
    return Promise.resolve({ ok: false, status: 401, error: "Anmeldung erforderlich." });
  }
  if (input.action === "planning-items.tokens.manage") return authorizePersonalPlanningTokenManagement(input as PersonalPlanningTokenManagementInput);
  if (input.action === "workweek.private.read" || input.action === "workweek.private.write") return authorizePrivateDraft(input as PrivateDraftCredentialInput);
  if (input.action === "calendar.read") return authorizeCalendar(input.credential.request);
  return authorizeLegacySession(input as CredentialActionInput);
}
