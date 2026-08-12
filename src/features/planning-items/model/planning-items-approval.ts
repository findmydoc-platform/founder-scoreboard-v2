import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { validateApprovalDecisionNote } from "@/lib/approval-decision-policy";
import { mapTaskRow } from "@/lib/planning-task-mappers";
import type { DbPlanningItemRaciAssignment, DbPlanningItemStrategy, DbTask } from "@/lib/planning-data-row-types";
import type { Task } from "@/lib/types";
import { attemptPlanningGitHubLifecycleDrain, loadOutstandingPlanningGitHubLifecycleTaskIds } from "@/lib/planning-github-lifecycle-trigger";
import { createPlanningItems, type PlanningDecisionCore } from "./planning-items-runner";
import { createSupabasePlanningItemsStore } from "./planning-items-store-supabase";
import type { ActOnItem, PlanningAction, PlanningError, PlanningItems, PlanningResult } from "./planning-items";
import type { PlanningCommitOutcome, PlanningCommitRequest, PlanningPreparation, PlanningPreparationRequest } from "./planning-items-store";

type ApprovalAction = Extract<PlanningAction, { kind: "decideApproval" }>;
type ApprovalKind = "initiative" | "deliverable";
type ApprovalWireAction = "approve" | "reject" | "return_to_draft";

type ApprovalItemState = Readonly<{
  row: DbTask;
  task: Task;
  kind: string;
  approvalStatus: string;
  approvalRevision: number;
  trashed: boolean;
  reviewLocked: boolean;
  reviewFinal: boolean;
}>;

export type PlanningApprovalState = Readonly<{
  item: ApprovalItemState | null;
  parent: Readonly<{ kind: string; approvalStatus: string; trashed: boolean }> | null;
  actorRole: string;
  accountableCount: number;
  responsibleCount: number;
  strategy?: DbPlanningItemStrategy;
  raciAssignments: readonly DbPlanningItemRaciAssignment[];
}>;

export type PlanningApprovalCommitPlan = Readonly<{
  itemId: string;
  itemKind: ApprovalKind;
  expectedApprovalRevision: number;
  action: ApprovalWireAction;
  note: string;
  before: Task;
  projected: Task;
}>;

type QueryResult = Readonly<{ data: unknown; error: unknown | null }>;
type PlanningSupabase = Readonly<{ rpc(name: string, params: Readonly<Record<string, unknown>>): Promise<QueryResult> }>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function rows(value: unknown) {
  return Array.isArray(value) ? value.flatMap((candidate) => record(candidate) ? [candidate as Record<string, unknown>] : []) : [];
}

function invalid(reason: string): PlanningError {
  return { code: "invalidCommand", issues: [{ path: "command.action", reason }] };
}

function conflict(reason: string): PlanningError {
  return { code: "conflict", reason: "state", details: { planningApprovalReason: reason } };
}

function approvalAction(command: ActOnItem): ApprovalAction | null {
  return command.action.kind === "decideApproval" ? command.action : null;
}

function wireAction(decision: ApprovalAction["decision"]): ApprovalWireAction {
  return decision === "approved" ? "approve" : decision === "rejected" ? "reject" : "return_to_draft";
}

export function decidePlanningApprovalCommand(
  itemId: string,
  input: { expectedApprovalRevision: number; action: ApprovalWireAction; note: string },
): ActOnItem {
  return {
    kind: "actOnItem",
    action: {
      kind: "decideApproval",
      itemId,
      expectedApprovalRevision: input.expectedApprovalRevision,
      decision: input.action === "approve" ? "approved" : input.action === "reject" ? "rejected" : "draft",
      note: input.note,
    },
  };
}

function projectedTask(item: ApprovalItemState, action: ApprovalWireAction, note: string): Task {
  const approved = action === "approve";
  return {
    ...item.task,
    approvalStatus: approved ? "approved" : action === "reject" ? "rejected" : "draft",
    approvalRevision: item.approvalRevision + 1,
    decisionNote: note,
    ...(item.kind === "deliverable" && !approved ? {
      sprintId: "",
      reviewStatus: "not_requested",
      reviewRequestedAt: "",
      scorePoints: 0,
      scoreFinal: false,
    } : {}),
    ...(item.kind === "deliverable" && action !== "reject" ? { githubIssueSyncStatus: "not_synced" } : {}),
  };
}

function decideApproval(action: ApprovalAction, state: PlanningApprovalState) {
  const item = state.item;
  if (!item) return { ok: false as const, error: { code: "notFound", entity: { kind: "deliverable", id: action.itemId } } as PlanningError };
  if (item.kind !== "initiative" && item.kind !== "deliverable") return { ok: false as const, error: invalid("approvalLifecycleMissing") };
  if (item.trashed) return { ok: false as const, error: conflict("trashed") };
  if (state.actorRole !== "ceo" && state.actorRole !== "deputy") return { ok: false as const, error: { code: "forbidden", reason: "approvalRequiresOperationalLead" } as PlanningError };
  if (item.approvalRevision !== action.expectedApprovalRevision) return { ok: false as const, error: { code: "conflict", reason: "revision" } as PlanningError };
  if (item.approvalStatus !== "proposed") return { ok: false as const, error: conflict("notProposed") };
  if (item.kind === "deliverable" && item.reviewLocked) return { ok: false as const, error: conflict(item.reviewFinal ? "reviewFinal" : "reviewLocked") };
  const actionName = wireAction(action.decision);
  const note = validateApprovalDecisionNote(actionName, action.note);
  if (!note.ok) return { ok: false as const, error: invalid(note.reason === "too_long" ? "noteTooLong" : "noteRequired") };
  if (actionName === "approve") {
    if (!state.parent) return { ok: false as const, error: conflict(item.row.parent_task_id ? "parentMissing" : "parentRequired") };
    if (state.parent.trashed) return { ok: false as const, error: conflict("parentMissing") };
    if (item.kind === "initiative") {
      if (state.parent.kind !== "epic") return { ok: false as const, error: conflict("invalidParent") };
      if (state.accountableCount !== 1 || state.responsibleCount < 1) return { ok: false as const, error: conflict("raciIncomplete") };
    } else if (state.parent.kind !== "initiative" || state.parent.approvalStatus !== "approved") {
      return { ok: false as const, error: conflict("parentNotApproved") };
    }
  }
  const normalizedNote = note.note || "";
  const after = projectedTask(item, actionName, normalizedNote);
  return {
    ok: true as const,
    before: item.task,
    after,
    plan: {
      itemId: item.task.id,
      itemKind: item.kind,
      expectedApprovalRevision: action.expectedApprovalRevision,
      action: actionName,
      note: normalizedNote,
      before: item.task,
      projected: after,
    } satisfies PlanningApprovalCommitPlan,
  };
}

function plannedEffects(kind: ApprovalKind) {
  return [
    { kind: "activity" as const, description: "Record the approval decision activity" },
    { kind: "audit" as const, description: "Record the approval decision audit event" },
    ...(kind === "deliverable" ? [{ kind: "githubLifecycle" as const, description: "Reconcile the Deliverable GitHub lifecycle" }] : []),
  ];
}

export const planningApprovalDecisionCore: PlanningDecisionCore<PlanningApprovalState, PlanningApprovalCommitPlan> = {
  decide({ command, state }) {
    if (command.kind !== "actOnItem") return { ok: false, error: invalid("approvalActionRequired") };
    const action = approvalAction(command);
    if (!action) return { ok: false, error: invalid("approvalActionRequired") };
    const decision = decideApproval(action, state);
    if (!decision.ok) return { ok: false, error: decision.error };
    return {
      ok: true,
      items: [],
      changes: [{ field: "approvalItem", before: decision.before, after: decision.after }],
      effects: plannedEffects(decision.plan.itemKind),
      warnings: [],
      commitPlan: decision.plan,
    };
  },
};

function preparationState(value: unknown): PlanningApprovalState | null {
  const source = record(value);
  if (!source) return null;
  const taskRow = record(source.task);
  const parentRow = record(source.parent);
  const profileNames = new Map(rows(source.profiles).map((profile) => [String(profile.id || ""), String(profile.name || "")]));
  const task = taskRow ? mapTaskRow(taskRow as unknown as DbTask, profileNames, {
    strategy: (record(source.strategy) || undefined) as DbPlanningItemStrategy | undefined,
    raciAssignments: rows(source.raciAssignments) as unknown as DbPlanningItemRaciAssignment[],
  }) : null;
  return {
    item: taskRow && task ? {
      row: taskRow as unknown as DbTask,
      task,
      kind: String(taskRow.task_type || ""),
      approvalStatus: String(taskRow.approval_status || ""),
      approvalRevision: Number(taskRow.approval_revision || 1),
      trashed: Boolean(taskRow.trashed_at),
      reviewLocked: taskRow.review_status === "requested" || Boolean(taskRow.score_final),
      reviewFinal: Boolean(taskRow.score_final) && taskRow.review_status === "accepted",
    } : null,
    parent: parentRow ? {
      kind: String(parentRow.task_type || ""),
      approvalStatus: String(parentRow.approval_status || ""),
      trashed: Boolean(parentRow.trashed_at),
    } : null,
    actorRole: String(source.actorRole || ""),
    accountableCount: Number(source.accountableCount || 0),
    responsibleCount: Number(source.responsibleCount || 0),
    strategy: (record(source.strategy) || undefined) as DbPlanningItemStrategy | undefined,
    raciAssignments: rows(source.raciAssignments) as unknown as DbPlanningItemRaciAssignment[],
  };
}

async function prepareApproval(supabase: PlanningSupabase, expectedKind: ApprovalKind, request: PlanningPreparationRequest): Promise<{ data: PlanningPreparation<PlanningApprovalState> | null; error: unknown | null }> {
  if (request.command.kind !== "actOnItem") return { data: { kind: "error", error: invalid("approvalActionRequired") }, error: null };
  const action = approvalAction(request.command);
  if (!action) return { data: { kind: "error", error: invalid("approvalActionRequired") }, error: null };
  const result = await supabase.rpc("prepare_planning_approval_command", {
    p_item_id: action.itemId,
    p_expected_kind: expectedKind,
    p_actor_profile_id: request.actor.profileId,
  });
  if (result.error) return { data: null, error: result.error };
  const state = preparationState(result.data);
  return state ? { data: { kind: "state", state }, error: null } : { data: null, error: new Error("Invalid planning approval state") };
}

function providerError(code: string, message: string, plan: PlanningApprovalCommitPlan): PlanningCommitOutcome | null {
  if (code === "P0001") return { ok: false, error: { code: "conflict", reason: "revision" } };
  if (code === "P0002") return { ok: false, error: { code: "notFound", entity: { kind: plan.itemKind, id: plan.itemId } } };
  if (code === "P0003") return { ok: false, error: conflict("notProposed") };
  if (code === "P0006") return { ok: false, error: { code: "forbidden", reason: "approvalRequiresOperationalLead" } };
  if (code === "P0009") return { ok: false, error: conflict(message.includes("final") ? "reviewFinal" : "reviewLocked") };
  if (code === "22023") return { ok: false, error: invalid("invalidApproval") };
  if (code === "23514") return { ok: false, error: conflict("approvalConstraint") };
  return null;
}

async function commitApproval(supabase: PlanningSupabase, request: PlanningCommitRequest<PlanningApprovalCommitPlan>): Promise<{ data: PlanningCommitOutcome | null; error: unknown | null }> {
  const result = await supabase.rpc("mutate_planning_approval_command_transaction", {
    p_task_id: request.plan.itemId,
    p_expected_kind: request.plan.itemKind,
    p_expected_revision: request.plan.expectedApprovalRevision,
    p_action: request.plan.action,
    p_actor_profile_id: request.actor.profileId,
    p_note: request.plan.note || null,
  });
  if (result.error) {
    const provider = result.error as { code?: unknown; message?: unknown };
    const mapped = providerError(String(provider.code || ""), String(provider.message || ""), request.plan);
    return mapped ? { data: mapped, error: null } : { data: null, error: result.error };
  }
  const transaction = record(result.data);
  const raw = record(transaction?.task);
  if (!raw) return { data: null, error: new Error("Planning approval result is incomplete") };
  const profileNames = new Map<string, string>();
  if (request.plan.before.ownerId) profileNames.set(request.plan.before.ownerId, request.plan.before.owner || request.plan.before.ownerId);
  if (request.plan.before.assigneeId) profileNames.set(request.plan.before.assigneeId, request.plan.before.assignee || request.plan.before.assigneeId);
  if (request.plan.before.createdById) profileNames.set(request.plan.before.createdById, request.plan.before.createdBy || request.plan.before.createdById);
  const mapped = mapTaskRow(raw as unknown as DbTask, profileNames, { strategy: undefined, raciAssignments: [] });
  const committed: Task = {
    ...request.plan.projected,
    approvalStatus: mapped.approvalStatus,
    approvalRevision: mapped.approvalRevision,
    decisionNote: mapped.decisionNote,
    updatedAt: mapped.updatedAt,
    sprintId: mapped.sprintId,
    reviewStatus: mapped.reviewStatus,
    reviewRequestedAt: mapped.reviewRequestedAt,
    scorePoints: mapped.scorePoints,
    scoreFinal: mapped.scoreFinal,
    githubIssueSyncStatus: mapped.githubIssueSyncStatus,
  };
  return {
    data: {
      ok: true,
      receipt: {
        items: [],
        changes: [{ field: "approvalItem", before: request.plan.before, after: committed }],
        effects: plannedEffects(request.plan.itemKind).map((effect) => ({
          ...effect,
          status: effect.kind === "githubLifecycle" ? "queued" as const : "applied" as const,
        })),
        replayed: false,
      },
    },
    error: null,
  };
}

export function createPlanningApprovalPlanningItems(supabaseClient: unknown, expectedKind: ApprovalKind): PlanningItems {
  const supabase = supabaseClient as PlanningSupabase;
  return createPlanningItems({
    store: createSupabasePlanningItemsStore<PlanningApprovalState, PlanningApprovalCommitPlan>({
      prepareCommand: (request) => prepareApproval(supabase, expectedKind, request),
      commitCommand: (request) => commitApproval(supabase, request),
    }),
    decisionCore: planningApprovalDecisionCore,
  });
}

export function planningApprovalTaskFromResult(result: Extract<PlanningResult, { ok: true }>) {
  const change = result.changes.find((candidate) => candidate.field === "approvalItem");
  return record(change?.after) as Task | null;
}

export function planningApprovalError(error: PlanningError, entityLabel: "Initiative" | "Deliverable") {
  if (error.code === "notFound") return { message: `${entityLabel} wurde nicht gefunden.`, status: 404 };
  if (error.code === "forbidden") return { message: "only ceo or deputy may decide planning approval", status: 403 };
  if (error.code === "invalidCommand") {
    const reason = error.issues[0]?.reason;
    if (reason === "noteTooLong") return { message: "Die Begründung darf höchstens 2.000 Zeichen lang sein.", status: 400 };
    if (reason === "noteRequired") return { message: "Für Ablehnung und Rückgabe ist eine Begründung erforderlich.", status: 400 };
    return { message: "Freigabeentscheidung ist ungültig.", status: 400 };
  }
  if (error.code === "conflict" && error.reason === "revision") return { message: `${entityLabel} wurde zwischenzeitlich entschieden. Bitte neu laden.`, status: 409 };
  if (error.code === "conflict") {
    const reason = String(error.details?.planningApprovalReason || "");
    if (reason === "reviewLocked") return { message: "Dieses Issue ist während des aktiven Reviews geschützt. Schließe das Review ab oder ziehe es mit Begründung zurück.", status: 409 };
    if (reason === "reviewFinal") return { message: "Dieses Issue ist nach dem finalen Review geschützt. Öffne das Review erneut, bevor du den Inhalt änderst.", status: 409 };
    if (reason === "trashed") return entityLabel === "Initiative"
      ? { message: "Initiative wurde nicht gefunden.", status: 404 }
      : { message: "Aufgabe befindet sich im Papierkorb und kann nicht geändert werden.", status: 409 };
    if (reason === "notProposed") return { message: "planning item is not proposed", status: 409 };
    if (reason === "parentRequired") return { message: "approved planning item requires a parent", status: 500 };
    if (reason === "parentMissing") return { message: "planning item parent was not found", status: 500 };
    if (reason === "invalidParent") return { message: "initiative parent must be an epic", status: 500 };
    if (reason === "raciIncomplete") return { message: "initiative approval requires one accountable and at least one responsible RACI assignment", status: 500 };
    if (reason === "parentNotApproved") return { message: "deliverable approval requires an approved initiative", status: 500 };
    return { message: `${entityLabel} kann in diesem Zustand nicht entschieden werden.`, status: 409 };
  }
  return { message: "Freigabeentscheidung konnte nicht gespeichert werden.", status: 500 };
}

export async function runPlanningApprovalLifecycle(supabase: SupabaseClient, taskId: string) {
  const scope = await loadOutstandingPlanningGitHubLifecycleTaskIds(supabase, "deliverable", taskId);
  return scope.error
    ? { attempted: false, completed: false, error: scope.error }
    : attemptPlanningGitHubLifecycleDrain({ rootType: "deliverable", rootId: taskId, taskIds: scope.taskIds, supabase });
}
