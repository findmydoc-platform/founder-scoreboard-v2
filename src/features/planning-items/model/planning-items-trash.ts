import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  validatePlanningTrashReason,
  validatePlanningTrashRevision,
} from "@/features/planning/model/planning-trash-contract";
import { isReviewStateLocked } from "@/features/reviews/model/task-review-state";
import type { TrashRootType } from "@/lib/types";
import { attemptPlanningGitHubLifecycleDrain } from "@/lib/planning-github-lifecycle-trigger";
import { createPlanningItems, type PlanningDecisionCore } from "./planning-items-runner";
import { createSupabasePlanningItemsStore } from "./planning-items-store-supabase";
import type { ActOnItem, PlanningAction, PlanningError, PlanningItems, PlanningResult } from "./planning-items";
import type { PlanningCommitOutcome, PlanningCommitRequest, PlanningPreparation, PlanningPreparationRequest } from "./planning-items-store";

type TrashAction = Extract<PlanningAction, { kind: "withdraw" | "restore" }>;

type PlanningTrashRootRow = Readonly<{
  id: string;
  task_type?: string | null;
  parent_task_id?: string | null;
  approval_status?: string | null;
  approval_revision?: number | null;
  proposed_by?: string | null;
  review_status?: string | null;
  score_final?: boolean | null;
  trashed_at?: string | null;
  trash_root_type?: string | null;
  trash_root_id?: string | null;
  trash_revision?: number | null;
}> & Readonly<Record<string, unknown>>;

export type PlanningTrashTransactionResult = Readonly<{
  rootType: TrashRootType;
  rootId: string;
  affectedTaskIds: readonly string[];
  trashRevision: number;
  item: Readonly<Record<string, unknown>> | null;
  eventIds: readonly (string | number)[];
}>;

export type PlanningTrashState = Readonly<{
  task: PlanningTrashRootRow | null;
  parent: PlanningTrashRootRow | null;
  actorRole: string;
  affectedTaskIds: readonly string[];
}>;

export type PlanningTrashCommitPlan = Readonly<{
  action: "withdraw" | "restore";
  rootType: TrashRootType;
  rootId: string;
  expectedRevision: number;
  reason: string | null;
  before: PlanningTrashRootRow;
  projected: PlanningTrashTransactionResult;
}>;

type QueryResult = Readonly<{ data: unknown; error: unknown | null }>;
type PlanningSupabase = Readonly<{ rpc(name: string, params: Readonly<Record<string, unknown>>): Promise<QueryResult> }>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.filter((candidate): candidate is string => typeof candidate === "string" && Boolean(candidate.trim())))]
    : [];
}

function values(value: unknown): Array<string | number> {
  return Array.isArray(value)
    ? value.filter((candidate): candidate is string | number => typeof candidate === "string" || typeof candidate === "number")
    : [];
}

function invalid(reason: string): PlanningError {
  return { code: "invalidCommand", issues: [{ path: "command.action", reason }] };
}

function stateConflict(reason: string): PlanningError {
  return { code: "conflict", reason: "state", details: { planningTrashReason: reason } };
}

function trashAction(command: ActOnItem): TrashAction | null {
  return command.action.kind === "withdraw" || command.action.kind === "restore" ? command.action : null;
}

export function withdrawPlanningItemCommand(
  itemId: string,
  input: { expectedApprovalRevision: number; reason: string },
): ActOnItem {
  return {
    kind: "actOnItem",
    action: {
      kind: "withdraw",
      itemId,
      expectedApprovalRevision: input.expectedApprovalRevision,
      reason: input.reason,
    },
  };
}

export function restorePlanningItemCommand(
  itemId: string,
  expectedTrashRevision: number,
): ActOnItem {
  return {
    kind: "actOnItem",
    action: { kind: "restore", itemId, expectedTrashRevision },
  };
}

function projectedResult(
  state: PlanningTrashState,
  action: TrashAction,
  rootType: TrashRootType,
): PlanningTrashTransactionResult {
  const task = state.task;
  const restoring = action.kind === "restore";
  const revision = restoring
    ? action.expectedTrashRevision
    : Number(task?.trash_revision || 0) + 1;
  return {
    rootType,
    rootId: action.itemId,
    affectedTaskIds: state.affectedTaskIds,
    trashRevision: revision,
    item: task ? {
      ...task,
      trashed_at: restoring ? null : "pending-commit",
      trash_revision: revision,
      trash_root_type: restoring ? null : rootType,
      trash_root_id: restoring ? null : action.itemId,
      ...(restoring ? { approval_status: "proposed" } : {}),
    } : null,
    eventIds: [],
  };
}

function decideTrash(action: TrashAction, rootType: TrashRootType, state: PlanningTrashState, actorProfileId: string) {
  const task = state.task;
  if (!task) return { ok: false as const, error: { code: "notFound", entity: { kind: rootType, id: action.itemId } } as PlanningError };
  if (task.task_type !== rootType) return { ok: false as const, error: invalid(rootType === "deliverable" ? "subIssueRootUnsupported" : "rootKindMismatch") };

  if (action.kind === "withdraw") {
    const reason = validatePlanningTrashReason(action.reason);
    if (!reason.ok) return { ok: false as const, error: invalid(reason.reason === "too_long" ? "reasonTooLong" : "reasonRequired") };
    if (!validatePlanningTrashRevision(action.expectedApprovalRevision)) return { ok: false as const, error: invalid("approvalRevisionRequired") };
    if (task.trashed_at) return { ok: false as const, error: stateConflict("alreadyTrashed") };
    if (rootType === "deliverable" && isReviewStateLocked(task.review_status, task.score_final)) {
      return { ok: false as const, error: stateConflict(task.review_status === "accepted" && task.score_final ? "reviewFinal" : "reviewLocked") };
    }
    if (task.approval_status !== "draft" && task.approval_status !== "proposed") return { ok: false as const, error: stateConflict("notWithdrawable") };
    if (Number(task.approval_revision || 0) !== action.expectedApprovalRevision) return { ok: false as const, error: { code: "conflict", reason: "revision" } as PlanningError };
    if (state.actorRole !== "ceo" && state.actorRole !== "deputy" && task.proposed_by !== actorProfileId) {
      return { ok: false as const, error: { code: "forbidden", reason: "withdrawRequiresProposerOrOperationalLead" } as PlanningError };
    }
    return { ok: true as const, reason: reason.reason };
  }

  if (!validatePlanningTrashRevision(action.expectedTrashRevision)) return { ok: false as const, error: invalid("trashRevisionRequired") };
  if (state.actorRole !== "ceo" && state.actorRole !== "deputy") return { ok: false as const, error: { code: "forbidden", reason: "restoreRequiresOperationalLead" } as PlanningError };
  if (!task.trashed_at || task.trash_root_type !== rootType || task.trash_root_id !== task.id) return { ok: false as const, error: stateConflict("notTrashedRoot") };
  if (Number(task.trash_revision || 0) !== action.expectedTrashRevision) return { ok: false as const, error: { code: "conflict", reason: "revision" } as PlanningError };
  if (task.parent_task_id && (!state.parent || state.parent.trashed_at)) return { ok: false as const, error: stateConflict("parentTrashed") };
  return { ok: true as const, reason: null };
}

function plannedEffects() {
  return [
    { kind: "activity" as const, description: "Record the planning trash activity" },
    { kind: "audit" as const, description: "Record the planning trash audit event" },
    { kind: "githubLifecycle" as const, description: "Queue ordered GitHub lifecycle reconciliation" },
  ];
}

export function createPlanningTrashDecisionCore(rootType: TrashRootType): PlanningDecisionCore<PlanningTrashState, PlanningTrashCommitPlan> {
  return {
    decide({ actor, command, state }) {
      if (command.kind !== "actOnItem") return { ok: false, error: invalid("trashActionRequired") };
      const action = trashAction(command);
      if (!action) return { ok: false, error: invalid("trashActionRequired") };
      const decision = decideTrash(action, rootType, state, actor.profileId);
      if (!decision.ok) return { ok: false, error: decision.error };
      const projected = projectedResult(state, action, rootType);
      return {
        ok: true,
        items: [],
        changes: [{ field: "planningTrash", before: state.task, after: projected }],
        effects: plannedEffects(),
        warnings: [],
        commitPlan: {
          action: action.kind,
          rootType,
          rootId: action.itemId,
          expectedRevision: action.kind === "withdraw" ? action.expectedApprovalRevision : action.expectedTrashRevision,
          reason: decision.reason,
          before: state.task!,
          projected,
        },
      };
    },
  };
}

function preparationState(value: unknown): PlanningTrashState | null {
  const source = record(value);
  if (!source) return null;
  return {
    task: record(source.task) as PlanningTrashRootRow | null,
    parent: record(source.parent) as PlanningTrashRootRow | null,
    actorRole: String(source.actorRole || ""),
    affectedTaskIds: strings(source.affectedTaskIds),
  };
}

async function prepareTrash(
  supabase: PlanningSupabase,
  rootType: TrashRootType,
  request: PlanningPreparationRequest,
): Promise<{ data: PlanningPreparation<PlanningTrashState> | null; error: unknown | null }> {
  if (request.command.kind !== "actOnItem") return { data: { kind: "error", error: invalid("trashActionRequired") }, error: null };
  const action = trashAction(request.command);
  if (!action) return { data: { kind: "error", error: invalid("trashActionRequired") }, error: null };
  const result = await supabase.rpc("prepare_planning_trash_command", {
    p_item_id: action.itemId,
    p_expected_kind: rootType,
    p_actor_profile_id: request.actor.profileId,
  });
  if (result.error) return { data: null, error: result.error };
  const state = preparationState(result.data);
  return state ? { data: { kind: "state", state }, error: null } : { data: null, error: new Error("Invalid planning trash state") };
}

function normalizedTransaction(data: unknown, plan: PlanningTrashCommitPlan): PlanningTrashTransactionResult {
  const result = record(data) || {};
  const item = record(result.item);
  const resultRootType = result.rootType ?? result.root_type;
  return {
    rootType: resultRootType === "initiative" || resultRootType === "deliverable" ? resultRootType : plan.rootType,
    rootId: typeof (result.rootId ?? result.root_id) === "string" ? String(result.rootId ?? result.root_id) : plan.rootId,
    affectedTaskIds: strings(result.affectedTaskIds ?? result.affected_task_ids),
    trashRevision: Number(result.trashRevision ?? result.trash_revision ?? plan.expectedRevision),
    item,
    eventIds: values(result.eventIds ?? result.event_ids),
  };
}

function providerError(code: string, message: string, plan: PlanningTrashCommitPlan): PlanningCommitOutcome | null {
  if (code === "P0001") return { ok: false, error: { code: "conflict", reason: "revision" } };
  if (code === "P0002") return { ok: false, error: { code: "notFound", entity: { kind: plan.rootType, id: plan.rootId } } };
  if (code === "P0003") {
    const reason = message.includes("parent")
      ? "parentTrashed"
      : message.includes("already trashed")
        ? "alreadyTrashed"
        : plan.action === "withdraw"
          ? "notWithdrawable"
          : "notTrashedRoot";
    return { ok: false, error: stateConflict(reason) };
  }
  if (code === "P0006") return { ok: false, error: { code: "forbidden", reason: plan.action === "withdraw" ? "withdrawRequiresProposerOrOperationalLead" : "restoreRequiresOperationalLead" } };
  if (code === "P0009") return { ok: false, error: stateConflict(message.includes("final") ? "reviewFinal" : "reviewLocked") };
  if (code === "22023") return { ok: false, error: invalid("invalidTrashAction") };
  return null;
}

async function commitTrash(
  supabase: PlanningSupabase,
  request: PlanningCommitRequest<PlanningTrashCommitPlan>,
): Promise<{ data: PlanningCommitOutcome | null; error: unknown | null }> {
  const result = await supabase.rpc("mutate_planning_trash_command_transaction", {
    p_action: request.plan.action,
    p_root_type: request.plan.rootType,
    p_root_id: request.plan.rootId,
    p_expected_revision: request.plan.expectedRevision,
    p_actor_profile_id: request.actor.profileId,
    p_reason: request.plan.reason,
    p_request_ip: request.requestMetadata?.requestIp || null,
    p_user_agent: request.requestMetadata?.userAgent || null,
  });
  if (result.error) {
    const provider = result.error as { code?: unknown; message?: unknown };
    const mapped = providerError(String(provider.code || ""), String(provider.message || ""), request.plan);
    return mapped ? { data: mapped, error: null } : { data: null, error: result.error };
  }
  const transaction = normalizedTransaction(result.data, request.plan);
  if (!transaction.item) return { data: null, error: new Error("Planning trash result is incomplete") };
  return {
    data: {
      ok: true,
      receipt: {
        items: [],
        changes: [{ field: "planningTrash", before: request.plan.before, after: transaction }],
        effects: plannedEffects().map((effect) => ({
          ...effect,
          status: effect.kind === "githubLifecycle" ? "queued" as const : "applied" as const,
        })),
        replayed: false,
      },
    },
    error: null,
  };
}

export function createPlanningTrashPlanningItems(supabaseClient: unknown, rootType: TrashRootType): PlanningItems {
  const supabase = supabaseClient as PlanningSupabase;
  return createPlanningItems({
    store: createSupabasePlanningItemsStore<PlanningTrashState, PlanningTrashCommitPlan>({
      prepareCommand: (request) => prepareTrash(supabase, rootType, request),
      commitCommand: (request) => commitTrash(supabase, request),
    }),
    decisionCore: createPlanningTrashDecisionCore(rootType),
  });
}

export function planningTrashTransactionFromResult(result: Extract<PlanningResult, { ok: true }>) {
  const change = result.changes.find((candidate) => candidate.field === "planningTrash");
  return record(change?.after) as PlanningTrashTransactionResult | null;
}

export function planningTrashError(error: PlanningError, rootType: TrashRootType, action: "withdraw" | "restore") {
  const label = rootType === "initiative" ? "Initiative" : "Deliverable";
  if (error.code === "notFound") return { message: `${label} wurde nicht gefunden.`, status: 404 };
  if (error.code === "forbidden") return { message: action === "withdraw" ? "Nur Antragsteller, CEO oder Deputy können dieses Item zurückziehen." : "Keine Berechtigung für diese Aktion.", status: 403 };
  if (error.code === "invalidCommand") {
    const reason = error.issues[0]?.reason;
    if (reason === "reasonTooLong") return { message: "Die Begründung darf höchstens 2.000 Zeichen lang sein.", status: 400 };
    if (reason === "reasonRequired") return { message: "Für das Zurückziehen ist eine Begründung erforderlich.", status: 400 };
    if (reason === "approvalRevisionRequired") return { message: "Aktueller Freigabestand ist erforderlich.", status: 400 };
    if (reason === "trashRevisionRequired") return { message: "Aktueller Papierkorbstand ist erforderlich.", status: 400 };
    if (reason === "subIssueRootUnsupported") return { message: `Sub-Issues können nicht unabhängig ${action === "withdraw" ? "zurückgezogen" : "wiederhergestellt"} werden.`, status: 400 };
    if (reason === "rootKindMismatch") return { message: "Initiative wurde nicht gefunden.", status: 400 };
    return { message: "Papierkorb-Aktion ist ungültig.", status: 400 };
  }
  if (error.code === "conflict" && error.reason === "revision") return { message: `${label} wurde zwischenzeitlich geändert. Bitte neu laden.`, status: 409 };
  if (error.code === "conflict") {
    const reason = String(error.details?.planningTrashReason || "");
    if (reason === "alreadyTrashed") return { message: `${label} liegt bereits im Papierkorb.`, status: 409 };
    if (reason === "notTrashedRoot") return { message: `${label} liegt nicht im Papierkorb.`, status: 409 };
    if (reason === "notWithdrawable") return { message: "Nur Entwürfe oder eingereichte Vorschläge können zurückgezogen werden.", status: 409 };
    if (reason === "reviewLocked") return { message: "Dieses Issue ist während des aktiven Reviews geschützt. Schließe das Review ab oder ziehe es mit Begründung zurück.", status: 409 };
    if (reason === "reviewFinal") return { message: "Dieses Issue ist nach dem finalen Review geschützt. Öffne das Review erneut, bevor du den Inhalt änderst.", status: 409 };
    if (reason === "parentTrashed") return { message: "parent planning item must be restored first", status: 409 };
    return { message: `${label} kann in diesem Zustand nicht ${action === "withdraw" ? "zurückgezogen" : "wiederhergestellt"} werden.`, status: 409 };
  }
  return { message: `${label} konnte nicht ${action === "withdraw" ? "zurückgezogen" : "wiederhergestellt"} werden.`, status: 500 };
}

export function runPlanningTrashLifecycle(supabase: SupabaseClient, result: PlanningTrashTransactionResult) {
  return attemptPlanningGitHubLifecycleDrain({
    rootType: result.rootType,
    rootId: result.rootId,
    taskIds: [...result.affectedTaskIds],
    supabase,
  });
}
