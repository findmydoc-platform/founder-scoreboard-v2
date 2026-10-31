import { observeRuntimePhase } from "../runtime-logging";
import { authorizePublicResource } from "./internal/public-resources";
import type { PublicResourceInput, PublicResourceResult } from "./public-resource-types";
import { authorizeResource, isResourceAction } from "./internal/resources";
import type { ResourceCredentialInput, ResourceCredentialResult } from "./resource-types";
import { authorizeNotificationDelivery } from "./internal/notification-delivery";
import { authorizeNotificationDigest } from "./internal/notification-digest";
import { authorizeDeliveryReconciliation } from "./internal/delivery-reconciliation";
import type { NotificationDeliveryInput, NotificationDeliveryResult, NotificationDigestInput, NotificationDigestResult, GitHubReconciliationInput, GitHubReconciliationResult } from "./notification-delivery-types";
import { authorizePlanningTrashMaintenance } from "./internal/planning-trash-maintenance";
import type { PlanningTrashMaintenanceInput, PlanningTrashMaintenanceResult } from "./maintenance-types";
import { authorizeCronWebhook } from "./internal/cron-webhook";
import type { CronWebhookInput, CronWebhookResult } from "./cron-types";
import { authorizeAccount } from "./internal/account";
import type { AccountCredentialInput, AccountCredentialResult } from "./account-types";
import { authorizeReleaseIngest } from "./internal/release-ingest";
import type { ReleaseIngestCredentialInput, ReleaseIngestCredentialResult } from "./release-ingest-types";
import { authorizeGitHubWebhook } from "./internal/github-webhook";
import type { GitHubWebhookInput, GitHubWebhookResult } from "./github-webhook-types";
import { authorizeDecisionLog } from "./internal/notion";
import type { DecisionLogCredentialInput, DecisionLogCredentialResult } from "./notion-types";
import { authorizePlanning, isPlanningAction } from "./internal/planning";
import type { PlanningCredentialInput, PlanningCredentialResult } from "./types";
import { authorizeGoogleCalendar, authorizeGoogleCalendarConnection } from "./internal/google-calendar";
import type { GoogleCalendarCapability, GoogleCalendarInput, GoogleCalendarConnectionInput } from "./types";
import type { GoogleWorkspaceConnectionStatus } from "@/features/team-workweek/model/google-workspace-connection";
import { authorizeGoogleChat, googleChatStatus } from "./internal/google-chat";
import type { GoogleChatDeliveryInput, GoogleChatDeliveryResult, GoogleChatStatusInput, GoogleChatDeliveryStatus } from "./google-chat-types";
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
import { authorizeGitHubInstallation, installationOperationalStatus } from "./internal/github-installation";
import type {
  CalendarCredentialInput, CalendarCredentialResult,
  PrivateDraftCredentialInput, PrivateDraftCredentialResult, PrivateDraftReadResult, PrivateDraftWriteResult,
  GitHubInstallationInput, GitHubInstallationResult, GitHubInstallationStatusInput,
  PersonalPlanningCredentialInput, PersonalPlanningCredentialResult, PersonalPlanningTokenManagementInput, PersonalPlanningTokenManagementResult,
} from "./types";
import type { GitHubAppOperationalStatus } from "./types";

export type {
  CalendarCredentialInput, CalendarCredentialResult, CalendarReadCapability, CalendarSnapshot,
  GitHubInstallationCapability, GitHubUserCapability, GoogleCalendarCapability, GoogleCalendarMutation,
} from "./types";


export type { ServerSessionView, SessionLinkPageState } from "./session-types";

export function authorizeCredentialAction(input: PublicResourceInput): Promise<PublicResourceResult>;
export function authorizeCredentialAction(input: ResourceCredentialInput): Promise<ResourceCredentialResult>;
export function authorizeCredentialAction(input: NotificationDeliveryInput): Promise<NotificationDeliveryResult>;
export function authorizeCredentialAction(input: NotificationDigestInput): Promise<NotificationDigestResult>;
export function authorizeCredentialAction(input: GitHubReconciliationInput): Promise<GitHubReconciliationResult>;
export function authorizeCredentialAction(input: PlanningTrashMaintenanceInput): Promise<PlanningTrashMaintenanceResult>;
export function authorizeCredentialAction(input: CronWebhookInput): Promise<CronWebhookResult>;
export function authorizeCredentialAction(input: ReleaseIngestCredentialInput): Promise<ReleaseIngestCredentialResult>;
export function authorizeCredentialAction(input: GitHubWebhookInput): Promise<GitHubWebhookResult>;
export function authorizeCredentialAction(input: DecisionLogCredentialInput): Promise<DecisionLogCredentialResult>;
export function authorizeCredentialAction(input: PlanningCredentialInput): Promise<PlanningCredentialResult>;
export function authorizeCredentialAction(input: GoogleCalendarInput & {action:"google-calendar.workweek"}): Promise<{ok:true;calendar:GoogleCalendarCapability}>;
export function authorizeCredentialAction(input: GoogleCalendarInput & {action:"google-calendar.connection.status"}): Promise<GoogleWorkspaceConnectionStatus>;
export function authorizeCredentialAction(input: GoogleCalendarInput & {action:"google-calendar.connection.remove"}): Promise<{ok:true}>;
export function authorizeCredentialAction(input: GoogleCalendarConnectionInput): Promise<{next:string;redirect?:string}>;
export function authorizeCredentialAction(input: GoogleChatDeliveryInput): Promise<GoogleChatDeliveryResult>;
export function authorizeCredentialAction(input: GoogleChatStatusInput): Promise<GoogleChatDeliveryStatus>;
export function authorizeCredentialAction(input: AccountCredentialInput): Promise<AccountCredentialResult>;
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

export function authorizeCredentialAction(input: PublicResourceInput | NotificationDeliveryInput | NotificationDigestInput | GitHubReconciliationInput | PlanningTrashMaintenanceInput | GoogleCalendarInput | GoogleCalendarConnectionInput | CalendarCredentialInput | PrivateDraftCredentialInput | GitHubInstallationInput | GitHubInstallationStatusInput | GitHubAuthoredCredentialInput | GitHubAttachmentInput | GitHubSessionInput | GitHubConnectionInput | PersonalPlanningCredentialInput | PersonalPlanningTokenManagementInput | SessionLifecycleInput | SessionCookieResponseInput | SessionPlanningInput | SessionHomeInput | SessionLinkPageInput | AdministratorCredentialInput | GoogleChatDeliveryInput | GoogleChatStatusInput | CronWebhookInput | AccountCredentialInput | ReleaseIngestCredentialInput | GitHubWebhookInput | DecisionLogCredentialInput | PlanningCredentialInput | ResourceCredentialInput): Promise<NotificationDeliveryResult | NotificationDigestResult | GitHubReconciliationResult | PlanningTrashMaintenanceResult | {ok:true;calendar:GoogleCalendarCapability} | GoogleWorkspaceConnectionStatus | {next:string;redirect?:string} | CalendarCredentialResult | PrivateDraftCredentialResult | GitHubInstallationResult | GitHubAppOperationalStatus | GitHubAuthoredCredentialResult | GitHubConnectionStatus | GitHubConnectionResult | {ok:true} | PersonalPlanningCredentialResult | PersonalPlanningTokenManagementResult | Response | ServerPlanningAuth | AppWorkspace | SessionLinkPageState | AdministratorCredentialResult | GoogleChatDeliveryResult | GoogleChatDeliveryStatus | CronWebhookResult | AccountCredentialResult | ReleaseIngestCredentialResult | GitHubWebhookResult | DecisionLogCredentialResult | PlanningCredentialResult | ResourceCredentialResult | PublicResourceResult> {
  return observeRuntimePhase("credential.action", async () => {
    if (input.action === "health.inspect" || input.action === "historical-initiative.resolve") return Promise.resolve(authorizePublicResource(input));
    if (isResourceAction(input.action)) return authorizeResource(input as ResourceCredentialInput);
    if ((input.action.startsWith("notifications.") || input.action.startsWith("github.reconciliation.")) && input.credential.kind !== "notification-delivery-request") return Promise.resolve({ok:false,status:403,error:"Keine Berechtigung für diese Aktion."});
    if (input.action === "notifications.delivery.inspect" || input.action === "notifications.delivery.run") return authorizeNotificationDelivery(input as NotificationDeliveryInput);
    if (input.action === "notifications.digest.generate") return authorizeNotificationDigest(input as NotificationDigestInput);
    if (input.action === "github.reconciliation.preview" || input.action === "github.reconciliation.deliver") return authorizeDeliveryReconciliation(input as GitHubReconciliationInput);
    if (input.action.startsWith("maintenance.planning-trash.")) return authorizePlanningTrashMaintenance(input as PlanningTrashMaintenanceInput);
    if (input.action === "github.webhooks.drain") return input.credential.kind === "cron-request" ? authorizeCronWebhook(input) : Promise.resolve({ ok: false as const, status: 401 as const, error: "Ungültiger Cron-Secret." });
    if (input.action === "platform-release.ingest") return authorizeReleaseIngest(input);
    if (input.action === "github.webhook.accept") return input.credential.kind === "github-webhook-request" ? authorizeGitHubWebhook(input) : Promise.resolve({kind:"rejected" as const,status:403 as const,code:"github_webhook_unauthorized",message:"GitHub webhook credential is required."});
    if (input.action === "decision-log.read") return authorizeDecisionLog(input);
    if (isPlanningAction(input.action)) return authorizePlanning(input as PlanningCredentialInput);
    if (input.action === "google-calendar.connection.start" || input.action === "google-calendar.connection.complete") return authorizeGoogleCalendarConnection(input as GoogleCalendarConnectionInput);
    if (input.action === "google-calendar.workweek" || input.action === "google-calendar.connection.status" || input.action === "google-calendar.connection.remove") return authorizeGoogleCalendar(input as GoogleCalendarInput);
    if (input.action === "google-chat.status" && input.credential.kind === "google-chat-configuration") return Promise.resolve(googleChatStatus());
    if (input.action.startsWith("google-chat.")) return authorizeGoogleChat(input as GoogleChatDeliveryInput);
    if (input.action.startsWith("account.") || input.action === "releases.read" || input.action === "releases.seen") return authorizeAccount(input as AccountCredentialInput);
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

    if (input.action.startsWith("github.") && input.credential.kind !== "github-installation" && input.credential.kind !== "github-claimed-job") {
      return Promise.resolve({ ok: false, status: 403, error: "Keine Berechtigung für diese Aktion." });
    }
    if (input.action === "github.projection.apply" || input.action === "github.lifecycle.apply" || input.action === "github.issue.read" || input.action === "github.project.read" || input.action === "github.team.read" || input.action === "github.asset.read") return authorizeGitHubInstallation(input);
    if (input.action === "github.installation.status") {
      if (input.credential.kind !== "github-installation") return Promise.resolve({ ok: false, status: 403, error: "Keine Berechtigung für diese Aktion." });
      return installationOperationalStatus();
    }
    if (input.credential.kind === "personal-planning-token") return authorizePersonalPlanning(input as PersonalPlanningCredentialInput);
    if (input.credential.kind !== "session-request") {
      return Promise.resolve({ ok: false, status: 403, error: "Keine Berechtigung für diese Aktion." });
    }
    if (input.action === "planning-items.tokens.manage") return authorizePersonalPlanningTokenManagement(input as PersonalPlanningTokenManagementInput);
    if (input.action === "workweek.private.read" || input.action === "workweek.private.write") return authorizePrivateDraft(input as PrivateDraftCredentialInput);
    if (input.action === "calendar.read") return authorizeCalendar(input.credential.request);
    return Promise.resolve({ ok: false, status: 403, error: "Keine Berechtigung für diese Aktion." });
  });
}

export type { GitHubJobContext } from "./github-job-types";
