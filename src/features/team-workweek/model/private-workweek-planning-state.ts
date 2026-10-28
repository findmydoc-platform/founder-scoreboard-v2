import type { PlanningReadStatus } from "@/features/planning/model/planning-state";
import type { OwnTeamWorkweekPublication, PendingTeamWorkweekPublication, PrivateTeamWorkweekDraft, PrivateTeamWorkweekVersion, TeamWorkweekEditBase, TeamWorkweekConflict, WorkweekActivationMode } from "./team-workweek-draft";

export type PrivateWorkweekContext = Readonly<{
  weekContext?: { weekStart: string; contextToken: string; effectiveUntil: string | null; basePublicationId: string | null; basePublicationRevision: number | null; windows: Array<{ weekday: number; startMinute: number; endMinute: number }> };
  version: PrivateTeamWorkweekVersion | null;
  publication?: OwnTeamWorkweekPublication | null;
  pendingPublication?: PendingTeamWorkweekPublication | null;
  latestPublished?: OwnTeamWorkweekPublication | null;
  preparedSuccessor?: OwnTeamWorkweekPublication | null;
  editBase?: TeamWorkweekEditBase | null;
  minimumEffectiveFrom: string;
  immediateAllowed?: boolean;
  restartAvailable?: boolean;
}>;
export type PrivateWorkweekSaveInput = PrivateTeamWorkweekDraft & { selectedWeekStart?: string; contextToken?: string };
export type PrivateWorkweekPublication = Readonly<{
  id: string; status: "preparing" | "published"; syncState: "delayed" | "confirmed";
  publicationRevision: number; publishedAt: string | null; lastSyncAt: string | null;
  effectiveAt?: string | null; effectiveUntil?: string | null; activationMode?: WorkweekActivationMode;
  successorPublicationId?: string | null; recovery: "retry" | "reconnect" | "identity_conflict" | null;
}>;
export type PrivateWorkweekFailure = { error?: string; code?: string; conflict?: { id: string; conflictRevision: number } | null; completionPending?: boolean };
export type PrivateWorkweekReply<T> = { status: number; value: (Partial<T> & PrivateWorkweekFailure) | null };
export type PrivateWorkweekSaveConfirmation = { version: Omit<PrivateTeamWorkweekVersion, "windows"> };
export type PrivateWorkweekPublicationConfirmation = { publication: PrivateWorkweekPublication };
export type PrivateWorkweekOperation<Input> = Readonly<{
  phase: "idle" | "saving" | "publishing" | "confirmed" | "preparing" | "rejected" | "unconfirmed";
  submitted: Readonly<Input> | null; error: string; checked: boolean;
}>;
export type PrivateWorkweekPublicationView = PrivateWorkweekOperation<{ versionId: string }> & { result: PrivateWorkweekPublication | null; sourceVersion: PrivateTeamWorkweekVersion | null; conflict: PrivateWorkweekFailure["conflict"] | null; completionPending: boolean };
export type WorkweekReconciliation = Readonly<{
  state: "unchanged" | "updated" | "delayed" | "conflict";
  lastSuccessfulSyncAt: string | null;
  recovery: "retry" | "reconnect" | "resolve_conflict" | "restart" | null;
  effectiveAt?: string | null;
  effectiveUntil?: string | null;
}>;
export type WorkweekReconciliationConfirmation = { reconciliation: WorkweekReconciliation };
export type WorkweekReconciliationView = Readonly<{
  phase: "idle" | "reconciling" | "confirmed" | "delayed" | "conflict" | "rejected" | "unconfirmed";
  displayedPublication: Readonly<{ id: string; publicationRevision: number }> | null;
  result: WorkweekReconciliation | null;
  error: string;
  checked: boolean;
}>;
export type WorkweekConflictRead = { conflict: TeamWorkweekConflict | null };
export type WorkweekConflictInput = Readonly<{ conflictId: string; conflictRevision: number; decision: "founderops" | "google" }>;
export type WorkweekConflictPublication = Pick<PrivateWorkweekPublication, "status" | "recovery"> & Partial<Omit<PrivateWorkweekPublication, "status" | "recovery">>;
export type WorkweekConflictConfirmation = { publication: WorkweekConflictPublication };
export type WorkweekConflictDecisionView = Readonly<{
  phase: "idle" | "resolving" | "preparing" | "published" | "stale" | "rejected" | "unconfirmed";
  submitted: WorkweekConflictInput | null;
  basis: TeamWorkweekConflict | null;
  result: WorkweekConflictPublication | null;
  error: string;
  checked: boolean;
}>;
export type WorkweekRestartInput = Readonly<{ versionId: string; pendingPublicationId: string | null }>;
export type WorkweekRestartConfirmation = { version?: PrivateTeamWorkweekVersion; restart: { state: "ready" | "delayed"; recovery: "retry" | "reconnect" | "identity_conflict" | null; reason?: "in_progress" | "uncertain" | "legacy_untracked" } };
export type WorkweekRestartView = Readonly<{
  phase: "idle" | "restarting" | "ready" | "delayed" | "rejected" | "unconfirmed";
  submitted: WorkweekRestartInput | null; result: WorkweekRestartConfirmation | null; error: string; checked: boolean;
}>;
export type WorkweekResumeInput = Readonly<{ publicationId: string; versionId: string }>;
export type WorkweekResumeView = Readonly<{
  phase: "idle" | "resuming" | "confirmed" | "preparing" | "rejected" | "unconfirmed";
  submitted: WorkweekResumeInput | null; result: WorkweekConflictPublication | null; error: string; checked: boolean;
}>;
export type WorkweekOperationHistory = Readonly<
  | { kind: "save"; operation: PrivateWorkweekOperation<PrivateWorkweekSaveInput> }
  | { kind: "publication"; operation: PrivateWorkweekPublicationView }
  | { kind: "reconciliation"; operation: WorkweekReconciliationView }
  | { kind: "conflictDecision"; operation: WorkweekConflictDecisionView }
  | { kind: "restart"; operation: WorkweekRestartView }
  | { kind: "resume"; operation: WorkweekResumeView }>;
export type PrivateWorkweekView = Readonly<{
  currentContextReady: boolean;
  recovery: Readonly<{ restartVersionId: string | null; resumablePublication: Pick<PendingTeamWorkweekPublication, "id" | "sourceVersionId"> | null }>;
  history: ReadonlyArray<WorkweekOperationHistory>;
  resume: WorkweekResumeView;
  restart: WorkweekRestartView;
  conflict: TeamWorkweekConflict | null;
  conflictReadStatus: PlanningReadStatus;
  conflictDecision: WorkweekConflictDecisionView;
  reconciliation: WorkweekReconciliationView;
  context: PrivateWorkweekContext | null;
  savedVersion: PrivateTeamWorkweekVersion | null;
  confirmedPublication: PrivateWorkweekPublication | null;
  readStatus: PlanningReadStatus;
  contextRefreshRequired: boolean;
  save: PrivateWorkweekOperation<PrivateWorkweekSaveInput>;
  publication: PrivateWorkweekPublicationView;
}>;
export type PrivateWorkweekAdapter = {
  restartPrivateWorkweek?: (versionId: string) => Promise<PrivateWorkweekReply<WorkweekRestartConfirmation>>;
  resolveWorkweekConflict?: (input: WorkweekConflictInput) => Promise<PrivateWorkweekReply<WorkweekConflictConfirmation>>;
  readWorkweekConflict?: () => Promise<PrivateWorkweekReply<WorkweekConflictRead>>;
  reconcilePrivateWorkweek?: () => Promise<PrivateWorkweekReply<WorkweekReconciliationConfirmation>>;
  readPrivateWorkweek?: (week?: string) => Promise<PrivateWorkweekReply<PrivateWorkweekContext>>;
  savePrivateWorkweek?: (input: PrivateWorkweekSaveInput) => Promise<PrivateWorkweekReply<PrivateWorkweekSaveConfirmation>>;
  publishPrivateWorkweek?: (versionId: string) => Promise<PrivateWorkweekReply<PrivateWorkweekPublicationConfirmation>>;
};
export interface PrivateWorkweekPlanningState {
  privateWorkweek(): PrivateWorkweekView;
  resumeWorkweekPublication(pending: Pick<PendingTeamWorkweekPublication, "id" | "sourceVersionId">): Promise<PrivateWorkweekReply<PrivateWorkweekPublicationConfirmation>>;
  restartWorkweek(versionId: string): Promise<PrivateWorkweekReply<WorkweekRestartConfirmation>>;
  resolveWorkweekConflict(basis: TeamWorkweekConflict, decision: "founderops" | "google"): Promise<PrivateWorkweekReply<WorkweekConflictConfirmation>>;
  loadWorkweekConflict(): Promise<PrivateWorkweekReply<WorkweekConflictRead>>;
  reconcileWorkweek(): Promise<PrivateWorkweekReply<WorkweekReconciliationConfirmation>>;
  loadPrivateWorkweek(week?: string): Promise<PrivateWorkweekReply<PrivateWorkweekContext>>;
  savePrivateWorkweek(input: PrivateWorkweekSaveInput): Promise<PrivateWorkweekReply<PrivateWorkweekSaveConfirmation>>;
  publishPrivateWorkweek(versionId: string): Promise<PrivateWorkweekReply<PrivateWorkweekPublicationConfirmation>>;
}
