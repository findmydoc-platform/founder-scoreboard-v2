import "server-only";
import { authorizeCalendar } from "./internal/session";
import type { CalendarCredentialInput, CalendarCredentialResult } from "./types";
import { authorizeLegacySession } from "./internal/legacy-session";
import type { CredentialActionInput, CredentialActionResult } from "./types";

export type { CredentialAction, CredentialActionInput, CredentialActionResult, CalendarCredentialInput, CalendarCredentialResult, CalendarReadCapability } from "./types";

import { authorizeGitHubInstallation, installationOperationalStatus } from "./internal/github-installation";
import type { GitHubInstallationInput, GitHubInstallationResult, GitHubInstallationStatusInput } from "./types";
import type { GitHubAppOperationalStatus } from "../github-app";
export type { GitHubInstallationCapability } from "./types";

export function authorizeCredentialAction(input: GitHubInstallationInput): Promise<GitHubInstallationResult>;
export function authorizeCredentialAction(input: GitHubInstallationStatusInput): Promise<GitHubAppOperationalStatus>;
export function authorizeCredentialAction(input: CalendarCredentialInput): Promise<CalendarCredentialResult>;
export function authorizeCredentialAction(input: CredentialActionInput): Promise<CredentialActionResult>;
export function authorizeCredentialAction(input: CredentialActionInput | CalendarCredentialInput | GitHubInstallationInput | GitHubInstallationStatusInput): Promise<CredentialActionResult | CalendarCredentialResult | GitHubInstallationResult | GitHubAppOperationalStatus> {
  if (input.action.startsWith("github.") && input.credential.kind !== "github-installation") {
    return Promise.resolve({ ok: false, status: 403, error: "Keine Berechtigung für diese Aktion." });
  }
  if (input.action === "github.projection.apply" || input.action === "github.lifecycle.apply" || input.action === "github.issue.read" || input.action === "github.project.read" || input.action === "github.team.read" || input.action === "github.asset.read") return authorizeGitHubInstallation(input);
  if (input.action === "github.installation.status") return installationOperationalStatus();
  if (input.credential.kind !== "session-request") {
    return Promise.resolve({ ok: false, status: 403, error: "Keine Berechtigung für diese Aktion." });
  }
  if (input.action === "calendar.read") return authorizeCalendar(input.credential.request);
  return authorizeLegacySession(input);
}
