import "server-only";
import { authorizeCalendar } from "./internal/session";
import { authorizePrivateDraft } from "./internal/private-draft";
import { authorizeLegacySession } from "./internal/legacy-session";
import { authorizeGitHubInstallation, installationOperationalStatus } from "./internal/github-installation";
import type {
  CalendarCredentialInput, CalendarCredentialResult, CredentialActionInput, CredentialActionResult,
  PrivateDraftCredentialInput, PrivateDraftCredentialResult, PrivateDraftReadResult, PrivateDraftWriteResult,
  GitHubInstallationInput, GitHubInstallationResult, GitHubInstallationStatusInput,
} from "./types";
import type { GitHubAppOperationalStatus } from "../github-app";

export type {
  CredentialAction, CredentialActionInput, CredentialActionResult,
  CalendarCredentialInput, CalendarCredentialResult, CalendarReadCapability,
  GitHubInstallationCapability,
} from "./types";

export function authorizeCredentialAction(input: GitHubInstallationInput): Promise<GitHubInstallationResult>;
export function authorizeCredentialAction(input: GitHubInstallationStatusInput): Promise<GitHubAppOperationalStatus>;
export function authorizeCredentialAction(input: PrivateDraftCredentialInput & {action: "workweek.private.read"}): Promise<PrivateDraftReadResult>;
export function authorizeCredentialAction(input: PrivateDraftCredentialInput & {action: "workweek.private.write"}): Promise<PrivateDraftWriteResult>;
export function authorizeCredentialAction(input: CalendarCredentialInput): Promise<CalendarCredentialResult>;
export function authorizeCredentialAction(input: CredentialActionInput): Promise<CredentialActionResult>;
export function authorizeCredentialAction(input: CredentialActionInput | CalendarCredentialInput | PrivateDraftCredentialInput | GitHubInstallationInput | GitHubInstallationStatusInput): Promise<CredentialActionResult | CalendarCredentialResult | PrivateDraftCredentialResult | GitHubInstallationResult | GitHubAppOperationalStatus> {
  if (input.action.startsWith("github.") && input.credential.kind !== "github-installation") {
    return Promise.resolve({ ok: false, status: 403, error: "Keine Berechtigung für diese Aktion." });
  }
  if (input.action === "github.projection.apply" || input.action === "github.lifecycle.apply" || input.action === "github.issue.read" || input.action === "github.project.read" || input.action === "github.team.read" || input.action === "github.asset.read") return authorizeGitHubInstallation(input);
  if (input.action === "github.installation.status") return installationOperationalStatus();
  if (input.credential.kind !== "session-request") {
    return Promise.resolve({ ok: false, status: 403, error: "Keine Berechtigung für diese Aktion." });
  }
  if (input.action === "workweek.private.read" || input.action === "workweek.private.write") return authorizePrivateDraft(input as PrivateDraftCredentialInput);
  if (input.action === "calendar.read") return authorizeCalendar(input.credential.request);
  return authorizeLegacySession(input);
}
