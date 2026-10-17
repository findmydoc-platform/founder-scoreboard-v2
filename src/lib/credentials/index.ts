import { authorizeGitHubConnection } from "./internal/github-user-oauth";
import type { GitHubConnectionInput, GitHubConnectionResult } from "./types";
import { authorizeAuthoredGitHub, authorizeGitHubAttachment, githubConnectionSession } from "./internal/github-user";
import type { GitHubAuthoredCredentialInput, GitHubAuthoredCredentialResult, GitHubAttachmentInput, GitHubSessionInput, GitHubConnectionStatus } from "./types";
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
import type { GitHubAppOperationalStatus } from "./types";

export type {
  CredentialAction, CredentialActionInput, CredentialActionResult,
  CalendarCredentialInput, CalendarCredentialResult, CalendarReadCapability,
  GitHubInstallationCapability, GitHubUserCapability,
} from "./types";

export function authorizeCredentialAction(input:GitHubConnectionInput):Promise<GitHubConnectionResult>;
export function authorizeCredentialAction(input:GitHubAuthoredCredentialInput|GitHubAttachmentInput):Promise<GitHubAuthoredCredentialResult>;
export function authorizeCredentialAction(input:GitHubSessionInput & {action:"github.connection.status"}):Promise<GitHubConnectionStatus>;
export function authorizeCredentialAction(input:GitHubSessionInput & {action:"github.connection.disconnect"}):Promise<{ok:true}>;
export function authorizeCredentialAction(input: GitHubInstallationInput): Promise<GitHubInstallationResult>;
export function authorizeCredentialAction(input: GitHubInstallationStatusInput): Promise<GitHubAppOperationalStatus>;
export function authorizeCredentialAction(input: PrivateDraftCredentialInput & {action: "workweek.private.read"}): Promise<PrivateDraftReadResult>;
export function authorizeCredentialAction(input: PrivateDraftCredentialInput & {action: "workweek.private.write"}): Promise<PrivateDraftWriteResult>;
export function authorizeCredentialAction(input: CalendarCredentialInput): Promise<CalendarCredentialResult>;
export function authorizeCredentialAction(input: CredentialActionInput): Promise<CredentialActionResult>;
export function authorizeCredentialAction(input: CredentialActionInput | CalendarCredentialInput | PrivateDraftCredentialInput | GitHubInstallationInput | GitHubInstallationStatusInput | GitHubAuthoredCredentialInput | GitHubAttachmentInput | GitHubSessionInput | GitHubConnectionInput): Promise<CredentialActionResult | CalendarCredentialResult | PrivateDraftCredentialResult | GitHubInstallationResult | GitHubAppOperationalStatus | GitHubAuthoredCredentialResult | GitHubConnectionStatus | GitHubConnectionResult | {ok:true}> {
  if (input.action==="github.connection.start" || input.action==="github.connection.complete") return authorizeGitHubConnection(input);
  if (input.action==="github.comment.deliver" || input.action==="github.comment.preview" || input.action==="github.review.deliver") return authorizeAuthoredGitHub(input);
  if (input.action==="github.attachment.write") return authorizeGitHubAttachment(input);
  if (input.action==="github.connection.status" || input.action==="github.connection.disconnect") return githubConnectionSession(input);
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
