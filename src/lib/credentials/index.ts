import { authorizePlanning, isPlanningAction } from "./internal/planning";
import type { PlanningCredentialInput, PlanningCredentialResult } from "./types";
import { authorizeGoogleCalendar, authorizeGoogleCalendarConnection } from "./internal/google-calendar";
import type { GoogleCalendarCapability, GoogleCalendarInput, GoogleCalendarConnectionInput } from "./types";
import type { GoogleWorkspaceConnectionStatus } from "@/features/team-workweek/model/google-workspace-connection";
import { authorizeAdministrator } from "./internal/administrator";
import type { AdministratorCredentialInput, AdministratorCredentialResult } from "./types";

import { authorizeGitHubConnection } from "./internal/github-user-oauth";
import type { GitHubConnectionInput, GitHubConnectionResult } from "./types";
import { authorizeAuthoredGitHub, authorizeGitHubAttachment, githubConnectionSession } from "./internal/github-user";
import type { GitHubAuthoredCredentialInput, GitHubAuthoredCredentialResult, GitHubAttachmentInput, GitHubSessionInput, GitHubConnectionStatus } from "./types";

import type { SessionLifecycleInput, SessionCookieResponseInput, SessionPlanningInput, SessionHomeInput, SessionLinkPageInput, ServerPlanningAuth, AppWorkspace, SessionLinkPageState } from "./session-types";
import { serverPlanningAuth, serverHomeWorkspace, serverLinkPage } from "./internal/server-session-view";
import { executeSessionLifecycle } from "./internal/session-lifecycle";

import "server-only";
import { authorizePersonalPlanning, authorizePersonalPlanningTokenManagement } from "./internal/personal-planning";
import { authorizeCalendar } from "./internal/session";
import { authorizePrivateDraft } from "./internal/private-draft";
import { authorizeLegacySession } from "./internal/legacy-session";
import { authorizeGitHubInstallation, installationOperationalStatus } from "./internal/github-installation";
import type {
  CalendarCredentialInput, CalendarCredentialResult, CredentialActionInput, CredentialActionResult,
  PrivateDraftCredentialInput, PrivateDraftCredentialResult, PrivateDraftReadResult, PrivateDraftWriteResult,
  GitHubInstallationInput, GitHubInstallationResult, GitHubInstallationStatusInput,
  PersonalPlanningCredentialInput, PersonalPlanningCredentialResult, PersonalPlanningTokenManagementInput, PersonalPlanningTokenManagementResult,
} from "./types";
import type { GitHubAppOperationalStatus } from "./types";

export type {
  CredentialAction, CredentialActionInput, CredentialActionResult,
  CalendarCredentialInput, CalendarCredentialResult, CalendarReadCapability,
  GitHubInstallationCapability, GitHubUserCapability, GoogleCalendarCapability,
} from "./types";


export type { ServerSessionView, SessionLinkPageState } from "./session-types";

export function authorizeCredentialAction(input: PlanningCredentialInput): Promise<PlanningCredentialResult>;
export function authorizeCredentialAction(input: GoogleCalendarInput & {action:"google-calendar.workweek"}): Promise<{ok:true;calendar:GoogleCalendarCapability}>;
export function authorizeCredentialAction(input: GoogleCalendarInput & {action:"google-calendar.connection.status"}): Promise<GoogleWorkspaceConnectionStatus>;
export function authorizeCredentialAction(input: GoogleCalendarInput & {action:"google-calendar.connection.remove"}): Promise<{ok:true}>;
export function authorizeCredentialAction(input: GoogleCalendarConnectionInput): Promise<{next:string;redirect?:string}>;
export function authorizeCredentialAction(input: AdministratorCredentialInput): Promise<AdministratorCredentialResult>;
export function authorizeCredentialAction(input:GitHubConnectionInput):Promise<GitHubConnectionResult>;
export function authorizeCredentialAction(input:GitHubAuthoredCredentialInput|GitHubAttachmentInput):Promise<GitHubAuthoredCredentialResult>;
export function authorizeCredentialAction(input:GitHubSessionInput & {action:"github.connection.status"}):Promise<GitHubConnectionStatus>;
export function authorizeCredentialAction(input:GitHubSessionInput & {action:"github.connection.disconnect"}):Promise<{ok:true}>;


export function authorizeCredentialAction(input: SessionPlanningInput): Promise<ServerPlanningAuth>;
export function authorizeCredentialAction(input: SessionHomeInput): Promise<AppWorkspace>;
export function authorizeCredentialAction(input: SessionLinkPageInput): Promise<SessionLinkPageState>;
export function authorizeCredentialAction(input: SessionCookieResponseInput): Promise<Response>;
export function authorizeCredentialAction(input: SessionLifecycleInput): Promise<Response>;
export function authorizeCredentialAction(input: PersonalPlanningTokenManagementInput): Promise<PersonalPlanningTokenManagementResult>;
export function authorizeCredentialAction(input: PersonalPlanningCredentialInput): Promise<PersonalPlanningCredentialResult>;

export function authorizeCredentialAction(input: GitHubInstallationInput): Promise<GitHubInstallationResult>;
export function authorizeCredentialAction(input: GitHubInstallationStatusInput): Promise<GitHubAppOperationalStatus>;
export function authorizeCredentialAction(input: PrivateDraftCredentialInput & {action: "workweek.private.read"}): Promise<PrivateDraftReadResult>;
export function authorizeCredentialAction(input: PrivateDraftCredentialInput & {action: "workweek.private.write"}): Promise<PrivateDraftWriteResult>;
export function authorizeCredentialAction(input: CalendarCredentialInput): Promise<CalendarCredentialResult>;
export function authorizeCredentialAction(input: CredentialActionInput): Promise<CredentialActionResult>;

export function authorizeCredentialAction(input: GoogleCalendarInput | GoogleCalendarConnectionInput | CredentialActionInput | CalendarCredentialInput | PrivateDraftCredentialInput | GitHubInstallationInput | GitHubInstallationStatusInput | GitHubAuthoredCredentialInput | GitHubAttachmentInput | GitHubSessionInput | GitHubConnectionInput | PersonalPlanningCredentialInput | PersonalPlanningTokenManagementInput | SessionLifecycleInput | SessionCookieResponseInput | SessionPlanningInput | SessionHomeInput | SessionLinkPageInput | AdministratorCredentialInput | PlanningCredentialInput): Promise<{ok:true;calendar:GoogleCalendarCapability} | GoogleWorkspaceConnectionStatus | {next:string;redirect?:string} | CredentialActionResult | CalendarCredentialResult | PrivateDraftCredentialResult | GitHubInstallationResult | GitHubAppOperationalStatus | GitHubAuthoredCredentialResult | GitHubConnectionStatus | GitHubConnectionResult | {ok:true} | PersonalPlanningCredentialResult | PersonalPlanningTokenManagementResult | Response | ServerPlanningAuth | AppWorkspace | SessionLinkPageState | AdministratorCredentialResult | PlanningCredentialResult> {
  if (isPlanningAction(input.action)) return authorizePlanning(input as PlanningCredentialInput);
  if (input.action === "google-calendar.connection.start" || input.action === "google-calendar.connection.complete") return authorizeGoogleCalendarConnection(input as GoogleCalendarConnectionInput);
  if (input.action === "google-calendar.workweek" || input.action === "google-calendar.connection.status" || input.action === "google-calendar.connection.remove") return authorizeGoogleCalendar(input as GoogleCalendarInput);
  if (["administrator-access.read", "administrator-access.activate", "administrator-access.end", "administration.directory.read", "administration.eligibility.manage", "administration.technical.update"].includes(input.action)) return authorizeAdministrator(input as AdministratorCredentialInput);
  if (input.credential.kind === "server-cookies") {
    if (input.action === "session.planning") return serverPlanningAuth();
    if (input.action === "session.home") return serverHomeWorkspace();
    if (input.action === "session.link-page") return serverLinkPage();
    return executeSessionLifecycle(input as SessionCookieResponseInput);
  }
  if (input.credential.kind === "http-request") return executeSessionLifecycle(input as SessionLifecycleInput);

  if (input.action==="github.connection.start" || input.action==="github.connection.complete") return authorizeGitHubConnection(input);
  if (input.action==="github.comment.deliver" || input.action==="github.comment.preview" || input.action==="github.review.deliver") return authorizeAuthoredGitHub(input);
  if (input.action==="github.attachment.write") return authorizeGitHubAttachment(input);
  if (input.action==="github.connection.status" || input.action==="github.connection.disconnect") return githubConnectionSession(input);

  if (input.action.startsWith("github.") && input.credential.kind !== "github-installation") {
    return Promise.resolve({ ok: false, status: 403, error: "Keine Berechtigung für diese Aktion." });
  }
  if (input.action === "github.projection.apply" || input.action === "github.lifecycle.apply" || input.action === "github.issue.read" || input.action === "github.project.read" || input.action === "github.team.read" || input.action === "github.asset.read") return authorizeGitHubInstallation(input);
  if (input.action === "github.installation.status") return installationOperationalStatus();
  if (input.credential.kind === "personal-planning-token") return authorizePersonalPlanning(input as PersonalPlanningCredentialInput);
  if (input.credential.kind !== "session-request") {
    return Promise.resolve({ ok: false, status: 403, error: "Keine Berechtigung für diese Aktion." });
  }
  if (input.action === "planning-items.tokens.manage") return authorizePersonalPlanningTokenManagement(input as PersonalPlanningTokenManagementInput);
  if (input.action === "workweek.private.read" || input.action === "workweek.private.write") return authorizePrivateDraft(input as PrivateDraftCredentialInput);
  if (input.action === "calendar.read") return authorizeCalendar(input.credential.request);
  return authorizeLegacySession(input as CredentialActionInput);
}
