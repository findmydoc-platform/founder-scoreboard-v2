import type { NextRequest } from "next/server";
import type { AuthzResult } from "../authz";

export type CredentialAction =
  | "calendar.read"
  | "workweek.private.read"
  | "workweek.private.write"
  | "team.read"
  | "planning.contribute"
  | "governance.ceo"
  | "operations.lead"
  | "planning.correct"
  | "operations.correct"
  | "administration.technical"
  | "administration.eligibility";

export type CredentialActionInput = {
  credential: { kind: "session-request"; request: NextRequest };
  action: CredentialAction;
};

export type CredentialActionResult = AuthzResult | CalendarCredentialResult | PrivateDraftCredentialResult;

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
