import "server-only";

import { createHash } from "node:crypto";
import { mapTaskRow } from "@/lib/planning-task-mappers";
import type { DbPlanningItemRaciAssignment, DbPlanningItemStrategy, DbTask } from "@/lib/planning-row-types";
import type { Task } from "@/lib/types";
import { createPlanningItems, type PlanningDecisionCore } from "./planning-items-runner";
import { createSupabasePlanningItemsStore } from "./planning-items-store-supabase";
import type { ActOnItem, PlanningAction, PlanningError, PlanningItems, PlanningResult } from "./planning-items";
import type { PlanningCommitOutcome, PlanningCommitRequest, PlanningPreparation, PlanningPreparationRequest } from "./planning-items-store";
import type { PlanningItemGitHubSyncCommand } from "./planning-items-contract";

type ReparentKind = "initiative" | "deliverable" | "sub_issue";
type ReparentRoute = "initiative" | "task";
type ReparentAction = Extract<PlanningAction, { kind: "changeParent" }>;
type ParentState = Readonly<{ id: string; kind: string; revision: string; approvalStatus: string; trashed: boolean; reviewLocked: boolean; reviewFinal: boolean }>;
type ItemState = Readonly<{ row: DbTask; task: Task; kind: string; revision: string; parentId: string; trashed: boolean; reviewLocked: boolean; reviewFinal: boolean }>;

export type PlanningReparentState = Readonly<{
  item: ItemState | null;
  parent: ParentState | null;
  oldParent: ParentState | null;
  requestedParentId: string;
  actor: Readonly<{ id: string; name: string; role: string }> | null;
  expectedKind: ReparentKind | "any";
}>;

export type PlanningReparentCommitPlan = Readonly<{
  itemId: string;
  itemKind: ReparentKind;
  expectedRevision: string;
  parentId: string;
  expectedParentRevision: string;
  parentApprovalStatus: string | null;
  before: Task;
  projected: Task;
  noop: boolean;
}>;

type QueryResult = Readonly<{ data: unknown; error: unknown | null }>;
type PlanningSupabase = Readonly<{ rpc(name: string, params: Readonly<Record<string, unknown>>): Promise<QueryResult> }>;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function records(value: unknown) { return Array.isArray(value) ? value.flatMap((row) => record(row) ? [row as Record<string, unknown>] : []) : []; }
function validTimestamp(value: unknown): value is string { return typeof value === "string" && Boolean(value) && !Number.isNaN(Date.parse(value)); }
function sameRevision(left: string, right: string) { return Date.parse(left) === Date.parse(right); }
function invalid(reason: string): PlanningError { return { code: "invalidCommand", issues: [{ path: "command.action", reason }] }; }
function conflict(reason: string): PlanningError { return { code: "conflict", reason: "state", details: { planningReparentReason: reason } }; }
function action(command: ActOnItem): ReparentAction | null { return command.action.kind === "changeParent" ? command.action : null; }

export function planningReparentHash(itemId: string, expectedRevision: string, parentId: string | null, requestedField = "parentTaskId") {
  const normalizedRevision = new Date(expectedRevision).toISOString();
  return createHash("sha256").update(JSON.stringify({ itemId, expectedRevision: normalizedRevision, parentId: parentId || null, requestedField }), "utf8").digest("hex");
}

export function isPlanningTaskReparentPayload(payload: unknown) {
  const row = record(payload);
  return Boolean(row && Object.hasOwn(row, "parentTaskId"));
}

export function parsePlanningTaskReparentPayload(payload: unknown):
  | Readonly<{ ok: true; value: { expectedUpdatedAt: string; parentId: string } }>
  | Readonly<{ ok: false; error: string; status: number }> {
  const row = record(payload);
  if (!row || !validTimestamp(row.expectedUpdatedAt)) return { ok: false, error: "Aktueller Aufgabenstand ist erforderlich.", status: 400 };
  const supported = new Set(["expectedUpdatedAt", "parentTaskId"]);
  if (Object.keys(row).some((key) => !supported.has(key))) return { ok: false, error: "Ändere die übergeordnete Planungsebene separat von weiteren Feldern.", status: 409 };
  const parent = row.parentTaskId;
  if (typeof parent !== "string") return { ok: false, error: "Übergeordnete Planungsebene ist ungültig.", status: 400 };
  return { ok: true, value: { expectedUpdatedAt: row.expectedUpdatedAt, parentId: parent.trim() } };
}

export function parsePlanningInitiativeReparentPayload(payload: unknown):
  | Readonly<{ ok: true; value: { parentId: string } }>
  | Readonly<{ ok: false; error: string; status: number }> {
  const row = record(payload);
  if (!row || typeof row.milestoneId !== "string") return { ok: false, error: "Initiative-Änderung ist ungültig.", status: 400 };
  if (Object.keys(row).some((key) => key !== "milestoneId")) return { ok: false, error: "Ändere das Epic separat von weiteren Initiative-Feldern.", status: 409 };
  return { ok: true, value: { parentId: row.milestoneId.trim() } };
}

export function changePlanningParentCommand(itemId: string, parentId: string | null, expectedRevision?: string): ActOnItem {
  return { kind: "actOnItem", action: { kind: "changeParent", itemId, parentId, ...(expectedRevision ? { expectedRevision } : {}) } };
}

function parentState(value: unknown): ParentState | null {
  const row = record(value);
  if (!row || !row.id) return null;
  return {
    id: String(row.id), kind: String(row.task_type || ""), revision: String(row.updated_at || ""),
    approvalStatus: String(row.approval_status || ""), trashed: Boolean(row.trashed_at),
    reviewLocked: row.review_status === "requested" || Boolean(row.score_final),
    reviewFinal: row.review_status === "accepted" && Boolean(row.score_final),
  };
}

function preparationState(value: unknown, expectedKind: ReparentKind | "any"): PlanningReparentState | null {
  const source = record(value);
  if (!source) return null;
  const row = record(source.task);
  const names = new Map(records(source.profiles).map((profile) => [String(profile.id || ""), String(profile.name || "")]));
  const task = row ? mapTaskRow(row as unknown as DbTask, names, {
    strategy: (record(source.strategy) || undefined) as DbPlanningItemStrategy | undefined,
    raciAssignments: records(source.raciAssignments) as unknown as DbPlanningItemRaciAssignment[],
  }) : null;
  const actor = record(source.actor);
  return {
    item: row && task ? {
      row: row as unknown as DbTask, task, kind: String(row.task_type || ""), revision: String(row.updated_at || ""),
      parentId: String(row.parent_task_id || ""), trashed: Boolean(row.trashed_at),
      reviewLocked: row.review_status === "requested" || Boolean(row.score_final),
      reviewFinal: row.review_status === "accepted" && Boolean(row.score_final),
    } : null,
    parent: parentState(source.parent),
    oldParent: parentState(source.oldParent),
    requestedParentId: String(source.requestedParentId || ""),
    actor: actor ? { id: String(actor.id || ""), name: String(actor.name || ""), role: String(actor.role || "") } : null,
    expectedKind,
  };
}

function owns(item: ItemState, actor: NonNullable<PlanningReparentState["actor"]>) {
  return [actor.id, actor.name].includes(String(item.row.owner || "")) || [actor.id, actor.name].includes(String(item.row.assignee || ""));
}

function effects(kind: ReparentKind, noop: boolean) {
  if (noop) return [];
  return [
    { kind: "audit" as const, description: "Record the parent change audit event" },
    ...(kind === "initiative" ? [] : [{ kind: "githubProjection" as const, description: "Mark the GitHub projection stale" }]),
  ];
}

function decide(actionInput: ReparentAction, state: PlanningReparentState) {
  const item = state.item;
  if (!item) return { ok: false as const, error: conflict("itemMissing") };
  if (item.kind !== "initiative" && item.kind !== "deliverable" && item.kind !== "sub_issue") return { ok: false as const, error: invalid("reparentUnsupported") };
  if (item.trashed) return { ok: false as const, error: conflict("trashed") };
  if (actionInput.expectedRevision && !sameRevision(actionInput.expectedRevision, item.revision)) return { ok: false as const, error: { code: "conflict", reason: "revision" } as PlanningError };
  if (!state.actor) return { ok: false as const, error: { code: "forbidden", reason: "reparentRequiresContributor" } as PlanningError };
  const operational = state.actor.role === "ceo" || state.actor.role === "deputy";
  if ((item.kind === "initiative" || item.kind === "deliverable") && !operational) return { ok: false as const, error: { code: "forbidden", reason: "reparentRequiresOperationalLead" } as PlanningError };
  if (item.kind === "sub_issue" && !operational && !owns(item, state.actor)) return { ok: false as const, error: { code: "forbidden", reason: "subIssueReparentRequiresOwnership" } as PlanningError };
  if (item.kind === "deliverable" && item.reviewLocked) return { ok: false as const, error: conflict(item.reviewFinal ? "reviewFinal" : "reviewLocked") };
  if (state.oldParent?.reviewLocked) return { ok: false as const, error: conflict(state.oldParent.reviewFinal ? "parentReviewFinal" : "parentReviewLocked") };
  const parentId = state.requestedParentId;
  if (item.kind === "sub_issue" && !parentId) return { ok: false as const, error: invalid("parentRequired") };
  if (parentId && !state.parent) return { ok: false as const, error: conflict(item.kind === "initiative" ? "parentMissingEpic" : item.kind === "deliverable" ? "parentMissingInitiative" : "parentMissingDeliverable") };
  if (state.parent?.trashed) return { ok: false as const, error: conflict(item.kind === "initiative" ? "parentMissingEpic" : item.kind === "deliverable" ? "parentMissingInitiative" : "parentMissingDeliverable") };
  const required = item.kind === "initiative" ? "epic" : item.kind === "deliverable" ? "initiative" : "deliverable";
  if (state.parent && state.parent.kind !== required) return { ok: false as const, error: invalid(item.kind === "initiative" ? "wrongParentTypeInitiative" : item.kind === "deliverable" ? "wrongParentTypeDeliverable" : "wrongParentTypeSubIssue") };
  if (item.kind === "deliverable" && state.parent?.approvalStatus === "rejected") return { ok: false as const, error: conflict("parentRejected") };
  if (item.kind === "sub_issue" && state.parent?.approvalStatus !== "approved") return { ok: false as const, error: conflict("parentNotApproved") };
  const noop = parentId === item.parentId;
  const projected: Task = {
    ...item.task,
    parentTaskId: parentId,
    ...(item.kind === "initiative" ? { milestoneId: parentId } : {}),
    ...(item.kind === "deliverable" ? { packageId: parentId, parentApprovalStatus: (state.parent?.approvalStatus || null) as Task["parentApprovalStatus"] } : {}),
    ...(item.kind === "sub_issue" ? { parentApprovalStatus: (state.parent?.approvalStatus || null) as Task["parentApprovalStatus"] } : {}),
  };
  return {
    ok: true as const,
    before: item.task,
    after: projected,
    plan: {
      itemId: item.task.id, itemKind: item.kind, expectedRevision: item.revision, parentId,
      expectedParentRevision: state.parent?.revision || "", parentApprovalStatus: state.parent?.approvalStatus || null,
      before: item.task, projected, noop,
    } satisfies PlanningReparentCommitPlan,
  };
}

export const planningReparentDecisionCore: PlanningDecisionCore<PlanningReparentState, PlanningReparentCommitPlan> = {
  decide({ command, state }) {
    if (command.kind !== "actOnItem") return { ok: false, error: invalid("reparentActionRequired") };
    const selected = action(command);
    if (!selected) return { ok: false, error: invalid("reparentActionRequired") };
    const decision = decide(selected, state);
    if (!decision.ok) return { ok: false, error: decision.error };
    return { ok: true, items: [], changes: [{ field: "reparentedItem", before: decision.before, after: decision.after }], effects: effects(decision.plan.itemKind, decision.plan.noop), warnings: [], commitPlan: decision.plan };
  },
};

async function prepareReparent(supabase: PlanningSupabase, expectedKind: ReparentKind | "any", request: PlanningPreparationRequest): Promise<{ data: PlanningPreparation<PlanningReparentState> | null; error: unknown | null }> {
  if (request.command.kind !== "actOnItem") return { data: { kind: "error", error: invalid("reparentActionRequired") }, error: null };
  const selected = action(request.command);
  if (!selected) return { data: { kind: "error", error: invalid("reparentActionRequired") }, error: null };
  const result = await supabase.rpc("prepare_planning_reparent_command", { p_item_id: selected.itemId, p_parent_id: selected.parentId, p_expected_kind: expectedKind, p_actor_profile_id: request.actor.profileId });
  if (result.error) return { data: null, error: result.error };
  const state = preparationState(result.data, expectedKind);
  return state ? { data: { kind: "state", state }, error: null } : { data: null, error: new Error("Invalid planning reparent state") };
}

function providerError(code: string, message: string, plan: PlanningReparentCommitPlan): PlanningCommitOutcome | null {
  if (code === "P0001") return { ok: false, error: { code: "conflict", reason: "revision" } };
  if (code === "P0012") return { ok: false, error: conflict("parentRevision") };
  if (code === "P0002") return { ok: false, error: { code: "notFound", entity: { kind: plan.itemKind, id: plan.itemId } } };
  if (code === "P0003") return { ok: false, error: conflict("trashed") };
  if (code === "P0013") return { ok: false, error: { code: "conflict", reason: "idempotency" } };
  if (code === "P0004" || code === "P0005") return { ok: false, error: { code: "forbidden", reason: "reparentTokenInactiveOrMissingScope" } };
  if (code === "P0006") return { ok: false, error: { code: "forbidden", reason: "reparentAuthorizationChanged" } };
  if (code === "P0009") return { ok: false, error: conflict(message.includes("current parent") ? (message.includes("final") ? "parentReviewFinal" : "parentReviewLocked") : (message.includes("final") ? "reviewFinal" : "reviewLocked")) };
  if (code === "23514") return { ok: false, error: conflict("parentInvalid") };
  if (code === "22023") return { ok: false, error: invalid("reparentInvalid") };
  return null;
}

async function commitReparent(
  supabase: PlanningSupabase,
  request: PlanningCommitRequest<PlanningReparentCommitPlan>,
  teamChangedField: string,
  projectionCommand?: PlanningItemGitHubSyncCommand | null,
): Promise<{ data: PlanningCommitOutcome | null; error: unknown | null }> {
  const token = request.actor.credential.kind === "planningToken" ? request.actor.credential : null;
  const result = token
    ? await supabase.rpc(projectionCommand
        ? "mutate_team_planning_reparent_with_projection_transaction"
        : "mutate_team_planning_reparent_command_transaction", {
        p_token_id: token.tokenId,
        p_profile_id: request.actor.profileId,
        p_item_id: request.plan.itemId,
        p_item_type: request.plan.itemKind,
        p_expected_updated_at: request.plan.expectedRevision,
        p_parent_task_id: request.plan.parentId || null,
        p_expected_parent_updated_at: request.plan.expectedParentRevision || null,
        p_idempotency_key: request.idempotencyKey || null,
        p_request_hash: planningReparentHash(request.plan.itemId, request.plan.expectedRevision, request.plan.parentId || null, teamChangedField),
        p_changed_field: teamChangedField,
        ...(projectionCommand ? { p_projection_command: projectionCommand } : {}),
        p_request_ip: request.requestMetadata?.requestIp || null,
        p_user_agent: request.requestMetadata?.userAgent || null,
      })
    : await supabase.rpc("mutate_planning_reparent_command_transaction", {
        p_task_id: request.plan.itemId, p_expected_kind: request.plan.itemKind, p_expected_updated_at: request.plan.expectedRevision,
        p_parent_task_id: request.plan.parentId || null, p_expected_parent_updated_at: request.plan.expectedParentRevision || null,
        p_actor_profile_id: request.actor.profileId,
      });
  if (result.error) {
    const mapped = providerError(String((result.error as { code?: unknown }).code || ""), String((result.error as { message?: unknown }).message || ""), request.plan);
    return mapped ? { data: mapped, error: null } : { data: null, error: result.error };
  }
  const transaction = record(result.data);
  const raw = record(transaction?.task || transaction?.item);
  if (!raw) return { data: null, error: new Error("Planning reparent result is incomplete") };
  const mapped = mapTaskRow(raw as unknown as DbTask, new Map());
  const committed: Task = {
    ...request.plan.projected,
    updatedAt: mapped.updatedAt,
    approvalStatus: mapped.approvalStatus,
    approvalRevision: mapped.approvalRevision,
    githubIssueSyncStatus: mapped.githubIssueSyncStatus,
    githubIssueSyncError: mapped.githubIssueSyncError,
  };
  return { data: { ok: true, receipt: { items: [], changes: [{ field: "reparentedItem", before: request.plan.before, after: committed }], effects: effects(request.plan.itemKind, request.plan.noop).map((effect) => ({ ...effect, status: "applied" as const })), replayed: Boolean(transaction?.replayed) } }, error: null };
}

export function createPlanningReparentPlanningItems(
  supabaseClient: unknown,
  expectedKind: ReparentKind | "any",
  teamChangedField = "parentTaskId",
  projectionCommand?: PlanningItemGitHubSyncCommand | null,
): PlanningItems {
  const supabase = supabaseClient as PlanningSupabase;
  return createPlanningItems({ store: createSupabasePlanningItemsStore<PlanningReparentState, PlanningReparentCommitPlan>({ prepareCommand: (request) => prepareReparent(supabase, expectedKind, request), commitCommand: (request) => commitReparent(supabase, request, teamChangedField, projectionCommand) }), decisionCore: planningReparentDecisionCore });
}

export function planningReparentTaskFromResult(result: Extract<PlanningResult, { ok: true }>) {
  return record(result.changes.find((change) => change.field === "reparentedItem")?.after) as Task | null;
}

export function planningReparentTasksFromResult(result: Extract<PlanningResult, { ok: true }>) {
  const change = result.changes.find((candidate) => candidate.field === "reparentedItem");
  return { before: record(change?.before) as Task | null, after: record(change?.after) as Task | null };
}

export function planningReparentError(error: PlanningError, route: ReparentRoute) {
  if (error.code === "notFound") return { message: route === "initiative" ? "Initiative wurde nicht gefunden." : "Aufgabe wurde nicht gefunden.", status: 404 };
  if (error.code === "forbidden") {
    if (error.reason === "subIssueReparentRequiresOwnership") return { message: "Nur CEO, Deputy oder die aktuelle Zuständigkeit können dieses Sub-Issue verschieben.", status: 403 };
    if (error.reason === "reparentRequiresOperationalLead") return { message: route === "initiative" ? "Diese Initiative-Felder sind geschützt: Epic." : "Deliverables können nur von CEO oder Deputy einer Initiative zugeordnet werden.", status: 403 };
    return { message: "Zuordnung darf nicht geändert werden.", status: 403 };
  }
  if (error.code === "invalidCommand") {
    const reason = error.issues[0]?.reason;
    if (reason === "parentRequired") return { message: "Ein Parent-Deliverable ist erforderlich.", status: 400 };
    if (reason === "wrongParentTypeSubIssue") return { message: "Sub-Issues können nur unter Deliverables verschoben werden.", status: 400 };
    if (reason === "wrongParentTypeDeliverable") return { message: "Deliverables können nur unter Initiativen eingeordnet werden.", status: 400 };
    if (reason === "wrongParentTypeInitiative") return { message: "Initiatives können nur unter Epics eingeordnet werden.", status: 400 };
    return { message: "Übergeordnete Planungsebene ist ungültig.", status: 400 };
  }
  if (error.code === "conflict" && error.reason === "revision") return { message: route === "initiative" ? "Initiative wurde zwischenzeitlich geändert. Bitte neu laden." : "Planungselement wurde zwischenzeitlich geändert. Bitte neu laden.", status: 409 };
  if (error.code === "conflict") {
    const reason = String(error.details?.planningReparentReason || "");
    if (reason === "itemMissing") return { message: route === "initiative" ? "Initiative wurde nicht gefunden." : "Aufgabe wurde nicht gefunden.", status: 404 };
    if (reason === "parentMissingEpic") return { message: "Epic wurde nicht gefunden.", status: 404 };
    if (reason === "parentMissingInitiative") return { message: "Initiative wurde nicht gefunden.", status: 404 };
    if (reason === "parentMissingDeliverable") return { message: "Übergeordnetes Planungselement wurde nicht gefunden.", status: 404 };
    if (reason === "parentRevision") return { message: "Übergeordnetes Planungselement wurde zwischenzeitlich geändert. Bitte neu laden.", status: 409 };
    if (reason === "parentNotApproved") return { message: "sub-issue parent must be approved", status: 400 };
    if (reason === "parentRejected") return { message: "Deliverables können nicht in einer abgelehnten Initiative liegen.", status: 400 };
    if (reason === "reviewFinal" || reason === "parentReviewFinal") return { message: "Dieses Issue ist nach dem finalen Review geschützt. Öffne das Review erneut, bevor du den Inhalt änderst.", status: 409 };
    if (reason === "reviewLocked" || reason === "parentReviewLocked") return { message: "Dieses Issue ist während des aktiven Reviews geschützt. Schließe das Review ab oder ziehe es mit Begründung zurück.", status: 409 };
    if (reason === "trashed") return { message: "Planungselement befindet sich im Papierkorb und kann nicht geändert werden.", status: 409 };
    return { message: "Übergeordnete Planungsebene ist ungültig.", status: 400 };
  }
  return { message: "Zuordnung konnte nicht gespeichert werden.", status: 500 };
}
