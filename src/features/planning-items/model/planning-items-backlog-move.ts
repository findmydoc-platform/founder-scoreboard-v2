import { ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";
import { createPlanningItems, type PlanningDecisionCore } from "./planning-items-runner";
import { createSupabasePlanningItemsStore } from "./planning-items-store-supabase";
import type {
  ActOnItem,
  PlanningAction,
  PlanningError,
  PlanningItems,
} from "./planning-items";
import type {
  PlanningCommitOutcome,
  PlanningCommitRequest,
  PlanningPreparation,
  PlanningPreparationRequest,
} from "./planning-items-store";

export type BacklogMovePlacement = "before" | "after";

export type BacklogMoveRequest = Readonly<{
  taskId: string;
  targetTaskId: string;
  placement: BacklogMovePlacement;
  expectedTaskUpdatedAt: string;
  expectedTargetUpdatedAt: string;
}>;

type BacklogItemState = Readonly<{
  id: string;
  kind: string;
  projectId: string;
  status: string;
  sortOrder: number;
  revision: string;
  trashed: boolean;
}>;

export type BacklogMoveState = Readonly<{
  requestedItems: readonly BacklogItemState[];
  activeBacklog: readonly BacklogItemState[];
}>;

export type BacklogMoveCommitPlan = Readonly<{
  taskId: string;
  targetTaskId: string;
  placement: BacklogMovePlacement;
  expectedTaskRevision: string;
  expectedTargetRevision: string;
}>;

export type BacklogMoveUpdate = Readonly<{
  id: string;
  sortOrder: number;
  updatedAt: string;
}>;

type QueryResult = Readonly<{ data: unknown; error: unknown }>;

type OrderedQuery = {
  eq(column: string, value: string): OrderedQuery;
  neq(column: string, value: string): OrderedQuery;
  order(column: string, options?: { ascending?: boolean }): PromiseLike<QueryResult>;
};

type PlanningSupabase = Readonly<{
  from(table: string): {
    select(columns: string): {
      in(column: string, values: readonly string[]): PromiseLike<QueryResult>;
      eq(column: string, value: string): OrderedQuery;
    };
  };
  rpc(name: string, params: Readonly<Record<string, unknown>>): Promise<QueryResult>;
}>;

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Boolean(value) && !Number.isNaN(Date.parse(value));
}

export function parseBacklogMoveRequest(payload: unknown): BacklogMoveRequest | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const candidate = payload as Partial<Record<keyof BacklogMoveRequest, unknown>>;
  const taskId = typeof candidate.taskId === "string" ? candidate.taskId.trim() : "";
  const targetTaskId = typeof candidate.targetTaskId === "string" ? candidate.targetTaskId.trim() : "";
  const placement = candidate.placement;
  if (
    !taskId
    || !targetTaskId
    || taskId === targetTaskId
    || (placement !== "before" && placement !== "after")
    || !validTimestamp(candidate.expectedTaskUpdatedAt)
    || !validTimestamp(candidate.expectedTargetUpdatedAt)
  ) return null;
  return {
    taskId,
    targetTaskId,
    placement,
    expectedTaskUpdatedAt: candidate.expectedTaskUpdatedAt,
    expectedTargetUpdatedAt: candidate.expectedTargetUpdatedAt,
  };
}

export function backlogMoveCommand(move: BacklogMoveRequest): ActOnItem {
  const target = { itemId: move.targetTaskId, expectedRevision: move.expectedTargetUpdatedAt };
  return {
    kind: "actOnItem",
    action: {
      kind: "moveBacklog",
      itemId: move.taskId,
      expectedRevision: move.expectedTaskUpdatedAt,
      ...(move.placement === "before" ? { before: target } : { after: target }),
    },
  };
}

function moveAction(command: ActOnItem): Extract<PlanningAction, { kind: "moveBacklog" }> | null {
  return command.action.kind === "moveBacklog" ? command.action : null;
}

function target(action: Extract<PlanningAction, { kind: "moveBacklog" }>) {
  if (action.before && !action.after) return { reference: action.before, placement: "before" as const };
  if (action.after && !action.before) return { reference: action.after, placement: "after" as const };
  return null;
}

function invalid(reason: string): PlanningError {
  return { code: "invalidCommand", issues: [{ path: "command.action", reason }] };
}

function plannedOrder(state: BacklogMoveState, taskId: string, targetTaskId: string, placement: BacklogMovePlacement) {
  const remaining = state.activeBacklog.filter((item) => item.id !== taskId);
  const targetIndex = remaining.findIndex((item) => item.id === targetTaskId);
  if (targetIndex < 0) return null;
  const source = state.activeBacklog.find((item) => item.id === taskId);
  if (!source) return null;
  const insertAt = placement === "before" ? targetIndex : targetIndex + 1;
  const ordered = [...remaining.slice(0, insertAt), source, ...remaining.slice(insertAt)];
  return ordered
    .map((item, index) => ({ id: item.id, before: item.sortOrder, after: (index + 1) * 10 }))
    .filter((item) => item.before !== item.after);
}

export const backlogMoveDecisionCore: PlanningDecisionCore<BacklogMoveState, BacklogMoveCommitPlan> = {
  decide({ actor, command, state }) {
    if (command.kind !== "actOnItem") return { ok: false, error: invalid("moveBacklogRequired") };
    const action = moveAction(command);
    if (!action) return { ok: false, error: invalid("moveBacklogRequired") };
    const destination = target(action);
    if (!destination || destination.reference.itemId === action.itemId) {
      return { ok: false, error: invalid("invalidRelativePlacement") };
    }
    if (actor.platformRole !== "ceo" && actor.platformRole !== "deputy") {
      return { ok: false, error: { code: "forbidden", reason: "backlogOrderRequiresOperationalLead" } };
    }
    const source = state.requestedItems.find((item) => item.id === action.itemId);
    const targetItem = state.requestedItems.find((item) => item.id === destination.reference.itemId);
    if (!source) return { ok: false, error: { code: "notFound", entity: { kind: "deliverable", id: action.itemId } } };
    if (!targetItem) return { ok: false, error: { code: "notFound", entity: { kind: "deliverable", id: destination.reference.itemId } } };
    if (
      source.projectId !== targetItem.projectId
      || source.kind !== "deliverable"
      || targetItem.kind !== "deliverable"
      || source.trashed
      || targetItem.trashed
      || source.status === "Erledigt"
      || targetItem.status === "Erledigt"
    ) return { ok: false, error: { code: "conflict", reason: "state" } };
    if (source.revision !== action.expectedRevision || targetItem.revision !== destination.reference.expectedRevision) {
      return { ok: false, error: { code: "conflict", reason: "revision" } };
    }
    const orderChanges = plannedOrder(state, source.id, targetItem.id, destination.placement);
    if (!orderChanges) return { ok: false, error: { code: "conflict", reason: "state" } };
    return {
      ok: true,
      items: [],
      changes: [{ field: "backlogOrder", before: null, after: orderChanges }],
      effects: orderChanges.length ? [{ kind: "audit", description: "Record backlog order change" }] : [],
      warnings: [],
      commitPlan: {
        taskId: source.id,
        targetTaskId: targetItem.id,
        placement: destination.placement,
        expectedTaskRevision: source.revision,
        expectedTargetRevision: targetItem.revision,
      },
    };
  },
};

function rowState(value: unknown): BacklogItemState | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : "";
  const revision = typeof row.updated_at === "string" ? row.updated_at : "";
  if (!id || !revision) return null;
  return {
    id,
    kind: String(row.task_type || ""),
    projectId: String(row.project_id || ""),
    status: String(row.status || ""),
    sortOrder: Number(row.sort_order || 0),
    revision,
    trashed: Boolean(row.trashed_at),
  };
}

async function prepareBacklogMove(
  supabase: PlanningSupabase,
  request: PlanningPreparationRequest,
): Promise<{ data: PlanningPreparation<BacklogMoveState> | null; error: unknown | null }> {
  if (request.command.kind !== "actOnItem") {
    return { data: { kind: "error", error: invalid("moveBacklogRequired") }, error: null };
  }
  const action = moveAction(request.command);
  const destination = action ? target(action) : null;
  if (!action || !destination) return { data: { kind: "error", error: invalid("invalidRelativePlacement") }, error: null };
  const requested = await supabase.from("tasks")
    .select("id,project_id,task_type,status,sort_order,updated_at,trashed_at")
    .in("id", [action.itemId, destination.reference.itemId]);
  if (requested.error) return { data: null, error: requested.error };
  const requestedItems = (Array.isArray(requested.data) ? requested.data : [])
    .map(rowState)
    .filter((item): item is BacklogItemState => Boolean(item));
  const sourceProjectId = requestedItems.find((item) => item.id === action.itemId)?.projectId;
  if (!sourceProjectId) {
    return { data: { kind: "state", state: { requestedItems, activeBacklog: [] } }, error: null };
  }
  const active = await supabase.from(ACTIVE_TASKS_TABLE)
    .select("id,project_id,task_type,status,sort_order,updated_at,trashed_at")
    .eq("project_id", sourceProjectId)
    .eq("task_type", "deliverable")
    .neq("status", "Erledigt")
    .order("sort_order", { ascending: true });
  if (active.error) return { data: null, error: active.error };
  return {
    data: {
      kind: "state",
      state: {
        requestedItems,
        activeBacklog: (Array.isArray(active.data) ? active.data : []).map(rowState).filter((item): item is BacklogItemState => Boolean(item)),
      },
    },
    error: null,
  };
}

function providerError(code: string, request: PlanningCommitRequest<BacklogMoveCommitPlan>): PlanningCommitOutcome | null {
  if (code === "P0001") return { ok: false, error: { code: "conflict", reason: "revision" } };
  if (code === "P0002") return { ok: false, error: { code: "notFound", entity: { kind: "deliverable", id: request.plan.taskId } } };
  if (code === "P0003") return { ok: false, error: { code: "conflict", reason: "state" } };
  if (code === "P0004") return { ok: false, error: { code: "forbidden", reason: "backlogOrderRequiresOperationalLead" } };
  if (code === "22023") return { ok: false, error: invalid("invalidBacklogMove") };
  return null;
}

function backlogUpdates(value: unknown): BacklogMoveUpdate[] | null {
  if (!Array.isArray(value)) return null;
  const updates = value.map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const row = entry as Record<string, unknown>;
    return typeof row.id === "string" && Number.isFinite(Number(row.sortOrder)) && typeof row.updatedAt === "string"
      ? { id: row.id, sortOrder: Number(row.sortOrder), updatedAt: row.updatedAt }
      : null;
  });
  return updates.every((entry): entry is BacklogMoveUpdate => Boolean(entry)) ? updates : null;
}

async function commitBacklogMove(
  supabase: PlanningSupabase,
  request: PlanningCommitRequest<BacklogMoveCommitPlan>,
): Promise<{ data: PlanningCommitOutcome | null; error: unknown | null }> {
  const metadata = request.requestMetadata;
  const result = await supabase.rpc("move_backlog_task_transaction", {
    p_task_id: request.plan.taskId,
    p_target_task_id: request.plan.targetTaskId,
    p_placement: request.plan.placement,
    p_expected_task_updated_at: request.plan.expectedTaskRevision,
    p_expected_target_updated_at: request.plan.expectedTargetRevision,
    p_actor_profile_id: request.actor.profileId,
    p_request_ip: metadata?.requestIp || null,
    p_user_agent: metadata?.userAgent || null,
  });
  if (result.error) {
    const mapped = providerError(String((result.error as { code?: unknown }).code || ""), request);
    return mapped ? { data: mapped, error: null } : { data: null, error: result.error };
  }
  const updates = backlogUpdates(result.data);
  if (!updates) return { data: null, error: new Error("Invalid backlog move result") };
  return {
    data: {
      ok: true,
      receipt: {
        items: [],
        changes: [{ field: "backlogOrder", before: null, after: updates }],
        effects: updates.length ? [{ kind: "audit", description: "Record backlog order change", status: "applied" }] : [],
        replayed: false,
      },
    },
    error: null,
  };
}

export function createBacklogMovePlanningItems(supabaseClient: unknown): PlanningItems {
  const supabase = supabaseClient as PlanningSupabase;
  const store = createSupabasePlanningItemsStore<BacklogMoveState, BacklogMoveCommitPlan>({
    prepareCommand: (request) => prepareBacklogMove(supabase, request),
    commitCommand: (request) => commitBacklogMove(supabase, request),
  });
  return createPlanningItems({ store, decisionCore: backlogMoveDecisionCore });
}

export function backlogMoveUpdatesFromChanges(changes: readonly { field: string; after: unknown }[]) {
  const updates = changes.find((change) => change.field === "backlogOrder")?.after;
  return backlogUpdates(updates) || [];
}

export function backlogMoveError(error: PlanningError): Readonly<{ message: string; status: number }> {
  if (error.code === "invalidCommand") return { message: "Backlog-Verschiebung ist ungültig.", status: 400 };
  if (error.code === "forbidden") return { message: "Nur CEO oder Deputy können die Backlog-Reihenfolge ändern.", status: 403 };
  if (error.code === "notFound") return { message: "Mindestens eine Aufgabe wurde nicht gefunden.", status: 404 };
  if (error.code === "conflict" && error.reason === "revision") return { message: "Backlog wurde parallel geändert. Bitte neu laden.", status: 409 };
  if (error.code === "conflict") return { message: "Backlog hat sich geändert. Bitte neu laden.", status: 409 };
  return { message: "Backlog-Reihenfolge konnte nicht dauerhaft gespeichert werden.", status: 500 };
}
