import type { GitHubJobContext } from "./github-job-types";
import type { NextRequest } from "next/server";
import type { AuthzResult } from "./auth-types";

export type CalendarPublication = Readonly<{
  id: string; owner_profile_id: string; effective_from: string; effective_to: string | null;
  effective_at?: string | null; effective_until?: string | null; timezone: "Europe/Berlin";
  published_at: string; last_sync_at: string; publication_revision: number;
  windows: Array<{ weekday: number; startMinute: number; endMinute: number }>;
}>;

type ReadResult<T> = Promise<{ data: T | null; error: { message: string } | null }>;
export type CalendarReadCapability = Readonly<{
  readPublications(earliestDate: string): ReadResult<CalendarPublication[]>;
  readPublishedOwners(): ReadResult<Array<{ owner_profile_id: string }>>;
}>;
export type CalendarCredentialInput = { credential: { kind: "session-request"; request: NextRequest }; action: "calendar.read" };
export type CalendarCredentialResult = Extract<AuthzResult, { ok: false }>
  | { ok: true; profile: NonNullable<Extract<AuthzResult, { ok: true }>["profile"]>; calendar: CalendarReadCapability };

export type GitHubInstallationCapability = Readonly<{
  asset(url: string): Promise<Response | null>;
  request(url: string, options: Omit<import("../github-http").GitHubRequestOptions, "token">): Promise<Response>;
}>;
export type GitHubInstallationAction = "github.projection.apply" | "github.lifecycle.apply" | "github.issue.read" | "github.project.read" | "github.team.read" | "github.asset.read";
export type GitHubInstallationInput = {
  [Action in GitHubInstallationAction]: {
    credential: Action extends "github.lifecycle.apply" ? { kind: "github-claimed-job"; claim: GitHubJobContext } : { kind: "github-installation" } | { kind: "github-claimed-job"; claim: GitHubJobContext };
    action: Action;
    target: { repositories: readonly string[]; organization?: string; assetUrl?: string };
  }
}[GitHubInstallationAction];
export type GitHubInstallationResult = { ok: true; github: GitHubInstallationCapability };
export type GitHubInstallationStatusInput = { credential: { kind: "github-installation" }; action: "github.installation.status" };
export type PrivateDraftPublication = Readonly<{
  id: string;
  effective_from: string;
  activation_mode?: "immediate" | "future_monday";
  effective_at?: string | null;
  effective_until?: string | null;
  effective_to?: string | null;
  attempt_generation?: number;
  source_version_id?: string;
  superseded_by_publication_id?: string | null;
  team_workweek_google_series?: Array<{id:string;google_event_id:string;confirmed_etag:string|null;state:string;provider_state:string;projection_part:string;source_window_ids:number[]|null}>;
  status: "preparing" | "published";
  sync_state: "pending" | "delayed" | "confirmed";
  publication_revision: number;
  published_at: string | null;
  last_sync_at: string | null;
  windows?: Array<{ weekday: number; startMinute: number; endMinute: number }>;
  team_workweek_google_reconciliation_status: Readonly<{
    state: "confirmed" | "pending" | "delayed" | "conflict";
    last_observed_at: string | null;
  }> | Array<Readonly<{
    state: "confirmed" | "pending" | "delayed" | "conflict";
    last_observed_at: string | null;
  }>> | null;
}>;

export type PreparedSuccessorBinding={id:string;revision:number;start:string;until?:string|null;effectiveTo?:string|null;sourceVersionId?:string|null;supersededBy?:string|null;windows?:Array<{weekday:number;startMinute:number;endMinute:number}>;series?:Array<{id:string;googleEventId:string;etag:string|null;state:string;providerState:string;part:string;sources:number[]|null}>};
export type PrivateDraftVersion = {
  id: string; owner_profile_id: string; effective_from: string; selected_week_start?: string | null;
  activation_mode?: "immediate" | "future_monday"; base_publication_id?: string | null; base_publication_revision?: number | null;
  successor_snapshot?: PreparedSuccessorBinding[] | null; timezone: "Europe/Berlin"; status: "preparing"; created_at: string;
  team_workweek_windows: Array<{ weekday: number; start_minute: number; end_minute: number }>;
};
export type PrivateDraftPendingPublication = {id:string;source_version_id:string;effective_from:string;effective_at:string|null;attempt_generation:number;write_journal_version:number;restart_requested_at:string|null;last_error_class:string|null};
export type PrivateDraftReadCapability = Readonly<{
  readAutomaticPublication(): ReadResult<PrivateDraftPublication>;
  readPublishedPublications(): ReadResult<PrivateDraftPublication[]>;
  readPendingPublication(): ReadResult<PrivateDraftPendingPublication>;
  readPrivateVersion(week?: string | null): ReadResult<PrivateDraftVersion>;
  readSourcePublication(versionId: string): ReadResult<PrivateDraftPublication>;
  readResolvingConflict(versionId: string): ReadResult<{ resolution_version_id: string }>;
  readAutomaticSource(versionId: string): ReadResult<PrivateDraftVersion>;
  readEditContext(week: string): ReadResult<{ basePublicationId?: string | null; basePublicationRevision?: number | null; [key: string]: unknown }>;
}>;
export type PrivateDraftSaveInput = { windows: Array<{weekday:number;startMinute:number;endMinute:number}>; effectiveFrom:string; activationMode?: "immediate" | "future_monday"; basePublicationId?:string; basePublicationRevision?:number; selectedWeekStart?: string; contextToken?: string };
export type PrivateDraftWriteCapability = Readonly<{ save(input: PrivateDraftSaveInput): Promise<{data:unknown;error:{code?:string;message:string}|null}> }>;
export type PrivateDraftCredentialInput = { credential: { kind: "session-request"; request: NextRequest }; action: "workweek.private.read" | "workweek.private.write" };
export type PrivateDraftReadResult = Extract<AuthzResult, { ok: false }> | { ok: true; profile: NonNullable<Extract<AuthzResult, {ok:true}>["profile"]>; privateDraft: PrivateDraftReadCapability };
export type PrivateDraftWriteResult = Extract<AuthzResult, { ok: false }> | { ok: true; profile: NonNullable<Extract<AuthzResult, {ok:true}>["profile"]>; privateDraft: PrivateDraftWriteCapability };
export type PrivateDraftCredentialResult = PrivateDraftReadResult | PrivateDraftWriteResult;

export type GitHubUserCapability = Readonly<{
  request(url: string, options: Omit<import("../github-http").GitHubRequestOptions, "token">): Promise<Response>;
}>;
export type GitHubAuthoredCredentialInput =
  | { credential: {kind:"github-comment-delivery";commentId:number;claimToken:string};action:"github.comment.deliver" }
  | { credential: {kind:"github-comment-preview";commentId:number;request:NextRequest};action:"github.comment.preview" }
  | { credential: {kind:"github-review-delivery";reviewId:number;claimToken:string};action:"github.review.deliver" };
export type GitHubAuthoredCredentialResult = {ok:true;github:GitHubUserCapability};
export type GitHubConnectionInput = {[Action in "github.connection.start"|"github.connection.complete"]:{credential:{kind:"github-oauth-request";request:NextRequest};action:Action}}["github.connection.start"|"github.connection.complete"];
export type GitHubConnectionResult = {ok:true;next:string;profileId:string;redirect?:string; resumePendingComments?: () => Promise<unknown>; resumePendingReviews?: () => Promise<unknown>};
export type GitHubSessionInput = {[Action in "github.connection.status"|"github.connection.disconnect"]:{credential:{kind:"session-request";request:NextRequest};action:Action}}["github.connection.status"|"github.connection.disconnect"];
export type GitHubConnectionStatus = {connected:boolean;needsReconnect:boolean;expiresAt:string|null};
export type GitHubAttachmentInput = {
  credential:{kind:"session-request";request:NextRequest};action:"github.attachment.write";
  target:{taskId:string;path:string;repository:string};
};

export type GitHubAppOperationalStatus = Readonly<{
  available: boolean;
  state: "ready" | "configuration_required" | "unavailable";
  description: string;
  nextStep: string;
}>;

export type PersonalPlanningCredentialInput = {
  credential: { kind: "personal-planning-token"; request: NextRequest };
  action: "planning-items.access";
  operation: "planningContext.read" | "planningItems.create" | "planningItems.update" | "planningItems.deleteEmpty" | "planningItems.githubSync";
  mode: "read" | "preview" | "commit";
  itemId?: string;
};
export type PersonalPlanningCredentialResult = Awaited<ReturnType<typeof import("./internal/personal-planning").authorizePersonalPlanning>>;

export type PersonalPlanningTokenManagementInput = {
  credential: { kind: "session-request"; request: NextRequest };
  action: "planning-items.tokens.manage";
};
export type PersonalPlanningTokenManagementResult = Awaited<ReturnType<typeof import("./internal/personal-planning").authorizePersonalPlanningTokenManagement>>;

export type GoogleCalendarCapability = Readonly<{
  request(url: string | URL, init?: RequestInit): Promise<Response>;
}>;
export type GoogleCalendarInput =
  | {credential:{kind:"session-request";request:NextRequest};action:"google-calendar.workweek" | "google-calendar.connection.status";target:{ownerProfileId:string}}
  | {credential:{kind:"session-request";request:NextRequest};action:"google-calendar.connection.remove";target:{ownerProfileId:string;operationId:string}};
export type GoogleCalendarConnectionInput = {credential:{kind:"google-calendar-oauth-request";request:NextRequest};action:"google-calendar.connection.start" | "google-calendar.connection.complete"};
export type AdministratorCredentialInput =
  | { credential: { kind: "server-cookies" }; action: "administration.directory.read" }
  | { credential: { kind: "session-request"; request: NextRequest }; action: "administrator-access.read" | "administrator-access.activate" | "administrator-access.end" | "administration.directory.read" }
  | { credential: { kind: "session-request"; request: NextRequest }; action: "administration.eligibility.manage" | "administration.technical.update"; targetProfileId: string };
export type AdministratorCredentialResult = Awaited<ReturnType<typeof import("./internal/administrator").authorizeAdministrator>>;

type PlanningRequestAction = {
  action: "planning.revision.read" | "planning.board.read" | "planning.header.read" | "planning.review.request" | "planning.review.decide" | "planning.review.withdraw" | "planning.review.reopen" | "planning.backlog.read" | "planning.sprint.read" | "planning.task.read" | "planning.task.update" | "planning.relationship.add" | "planning.relationship.remove" | "planning.task.delete" | "planning.task.create" | "planning.sprint.commitment.write" | "planning.sprint.update" | "planning.sprint.plan" | "planning.sprint.lock" | "planning.sprint.review-window" | "planning.sprint.objection.create" | "planning.sprint.objection.process" | "planning.sprint.assign" | "planning.backlog.move" | "planning.approval.decide" | "planning.trash.withdraw" | "planning.trash.restore" | "planning.focus.write" | "planning.focus.delete" | "planning.attendance.write" | "planning.comment.create" | "planning.blocker.report" | "planning.attachment.write" | "planning.github-comments.import" | "planning.github-sync.apply" | "workweek.publish" | "workweek.restart" | "workweek.conflict.read" | "workweek.conflict.resolve" | "workweek.reconcile";
};
export type PlanningCredentialInput = (
  | { credential: { kind: "session-request"; request: NextRequest }; action: PlanningRequestAction["action"] }
  | { credential: { kind: "server-cookies" }; action: "planning.revision.read" | "planning.board.read" | "planning.header.read" | "planning.backlog.read" | "planning.sprint.read" | "planning.task.read" }
) & { targetId?: string; targetIds?: readonly string[] };
export type PlanningCredentialResult = Awaited<ReturnType<typeof import("./internal/planning").authorizePlanning>>;
