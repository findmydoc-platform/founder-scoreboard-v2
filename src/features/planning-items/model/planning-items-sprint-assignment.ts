import { createPlanningItems, type PlanningDecisionCore } from "./planning-items-runner";
import { createSupabasePlanningItemsStore } from "./planning-items-store-supabase";
import type { ActOnItem, PlanningAction, PlanningError, PlanningItems } from "./planning-items";
import type {
  PlanningCommitOutcome,
  PlanningCommitRequest,
  PlanningPreparation,
  PlanningPreparationRequest,
} from "./planning-items-store";

export type SprintAssignmentInput = Readonly<{
  taskId: string;
  expectedUpdatedAt: string;
}>;

export type SprintAssignmentRequest = Readonly<{
  assignments: readonly SprintAssignmentInput[];
  sprintId: string;
}>;

type SprintAssignmentItemState = Readonly<{
  id: string;
  kind: string;
  revision: string;
  trashed: boolean;
  approvalStatus: string;
  status: string;
  ownerId: string;
  parentId: string;
  sprintId: string;
}>;

type SprintState = Readonly<{
  id: string;
  locked: boolean;
}>;

export type SprintAssignmentState = Readonly<{
  items: readonly SprintAssignmentItemState[];
  parents: readonly SprintAssignmentItemState[];
  sprints: readonly SprintState[];
}>;

export type SprintAssignmentCommitPlan = Readonly<{
  assignments: readonly SprintAssignmentInput[];
  sprintId: string;
}>;

export type SprintAssignmentUpdate = Readonly<{
  id: string;
  sprintId: string;
  scoreRelevant: boolean;
  updatedAt: string;
}>;

type QueryResult = Readonly<{ data: unknown; error: unknown }>;
type PlanningSupabase = Readonly<{
  from(table: string): {
    select(columns: string): {
      in(column: string, values: readonly string[]): PromiseLike<QueryResult>;
    };
  };
  rpc(name: string, params: Readonly<Record<string, unknown>>): Promise<QueryResult>;
}>;

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Boolean(value) && !Number.isNaN(Date.parse(value));
}

export function parseSprintAssignmentRequest(payload: unknown): SprintAssignmentRequest | string {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "Sprint-Zuordnung ist ungültig.";
  const candidate = payload as { assignments?: unknown; sprintId?: unknown };
  const sprintId = typeof candidate.sprintId === "string" ? candidate.sprintId.trim() : "";
  if (!sprintId || !Array.isArray(candidate.assignments) || candidate.assignments.length < 1 || candidate.assignments.length > 100) {
    return "Wähle zwischen 1 und 100 Deliverables sowie einen Sprint aus.";
  }
  const assignments: SprintAssignmentInput[] = [];
  const taskIds = new Set<string>();
  for (const value of candidate.assignments) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return "Sprint-Zuordnung ist ungültig.";
    const assignment = value as { taskId?: unknown; expectedUpdatedAt?: unknown };
    const taskId = typeof assignment.taskId === "string" ? assignment.taskId.trim() : "";
    if (!taskId || taskIds.has(taskId) || !validTimestamp(assignment.expectedUpdatedAt)) {
      return "Sprint-Zuordnung ist ungültig.";
    }
    taskIds.add(taskId);
    assignments.push({ taskId, expectedUpdatedAt: assignment.expectedUpdatedAt });
  }
  return { assignments, sprintId };
}

export function sprintAssignmentCommand(request: SprintAssignmentRequest): ActOnItem {
  return {
    kind: "actOnItem",
    action: {
      kind: "assignSprint",
      items: request.assignments.map((assignment) => ({
        itemId: assignment.taskId,
        expectedRevision: assignment.expectedUpdatedAt,
      })),
      sprintId: request.sprintId,
    },
  };
}

function assignmentAction(command: ActOnItem): Extract<PlanningAction, { kind: "assignSprint" }> | null {
  return command.action.kind === "assignSprint" ? command.action : null;
}

function invalid(reason: string): PlanningError {
  return { code: "invalidCommand", issues: [{ path: "command.action", reason }] };
}

function stateConflict(reason: string): PlanningError {
  return { code: "conflict", reason: "state", details: { sprintAssignmentReason: reason } };
}

export const sprintAssignmentDecisionCore: PlanningDecisionCore<SprintAssignmentState, SprintAssignmentCommitPlan> = {
  decide({ actor, command, state }) {
    if (command.kind !== "actOnItem") return { ok: false, error: invalid("assignSprintRequired") };
    const action = assignmentAction(command);
    if (!action || !action.sprintId || action.items.length < 1 || action.items.length > 100) {
      return { ok: false, error: invalid("invalidSprintAssignment") };
    }
    const ids = action.items.map((item) => item.itemId);
    if (new Set(ids).size !== ids.length) return { ok: false, error: invalid("duplicatePlanningItem") };
    if (actor.platformRole !== "ceo" && actor.platformRole !== "deputy") {
      return { ok: false, error: { code: "forbidden", reason: "sprintAssignmentRequiresOperationalLead" } };
    }
    const targetSprint = state.sprints.find((sprint) => sprint.id === action.sprintId);
    if (!targetSprint) return { ok: false, error: { code: "notFound", entity: { kind: "sprint", id: action.sprintId } } };
    if (targetSprint.locked) return { ok: false, error: stateConflict("targetSprintLocked") };

    for (const reference of action.items) {
      const item = state.items.find((candidate) => candidate.id === reference.itemId);
      if (!item || item.trashed) {
        return { ok: false, error: { code: "notFound", entity: { kind: "deliverable", id: reference.itemId } } };
      }
      if (item.revision !== reference.expectedRevision) return { ok: false, error: { code: "conflict", reason: "revision" } };
      if (item.kind !== "deliverable") return { ok: false, error: invalid("deliverableRequired") };
      if (item.approvalStatus !== "approved") return { ok: false, error: stateConflict("approvalRequired") };
      if (item.status === "Erledigt") return { ok: false, error: stateConflict("completed") };
      if (!item.ownerId) return { ok: false, error: stateConflict("ownerRequired") };
      const parent = state.parents.find((candidate) => candidate.id === item.parentId);
      if (!parent || parent.kind !== "initiative" || parent.approvalStatus !== "approved" || parent.trashed) {
        return { ok: false, error: stateConflict("approvedInitiativeRequired") };
      }
      if (item.sprintId && item.sprintId !== action.sprintId) {
        const sourceSprint = state.sprints.find((sprint) => sprint.id === item.sprintId);
        if (!sourceSprint) return { ok: false, error: stateConflict("sourceSprintMissing") };
        if (sourceSprint.locked) return { ok: false, error: stateConflict("sourceSprintLocked") };
      }
    }

    const assignments = action.items
      .map((item) => ({ taskId: item.itemId, expectedUpdatedAt: item.expectedRevision }))
      .sort((left, right) => left.taskId.localeCompare(right.taskId));
    return {
      ok: true,
      items: [],
      changes: [{
        field: "sprintAssignment",
        before: null,
        after: assignments.map((assignment) => ({ id: assignment.taskId, sprintId: action.sprintId, scoreRelevant: true })),
      }],
      effects: assignments.map((assignment) => ({ kind: "audit" as const, description: `Record Sprint assignment for ${assignment.taskId}` })),
      warnings: [],
      commitPlan: { assignments, sprintId: action.sprintId },
    };
  },
};

function itemState(value: unknown): SprintAssignmentItemState | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : "";
  const revision = typeof row.updated_at === "string" ? row.updated_at : "";
  if (!id || !revision) return null;
  return {
    id,
    kind: String(row.task_type || ""),
    revision,
    trashed: Boolean(row.trashed_at),
    approvalStatus: String(row.approval_status || ""),
    status: String(row.status || ""),
    ownerId: String(row.assignee || row.owner || ""),
    parentId: String(row.parent_task_id || ""),
    sprintId: String(row.sprint_id || ""),
  };
}

function sprintState(value: unknown): SprintState | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  return typeof row.id === "string" ? { id: row.id, locked: Boolean(row.score_locked) } : null;
}

async function prepareSprintAssignment(
  supabase: PlanningSupabase,
  request: PlanningPreparationRequest,
): Promise<{ data: PlanningPreparation<SprintAssignmentState> | null; error: unknown | null }> {
  if (request.command.kind !== "actOnItem") return { data: { kind: "error", error: invalid("assignSprintRequired") }, error: null };
  const action = assignmentAction(request.command);
  if (!action || !action.sprintId) return { data: { kind: "error", error: invalid("invalidSprintAssignment") }, error: null };
  const tasks = await supabase.from("tasks")
    .select("id,task_type,updated_at,trashed_at,approval_status,status,assignee,owner,parent_task_id,sprint_id")
    .in("id", action.items.map((item) => item.itemId));
  if (tasks.error) return { data: null, error: tasks.error };
  const items = (Array.isArray(tasks.data) ? tasks.data : []).map(itemState).filter((item): item is SprintAssignmentItemState => Boolean(item));
  const parentIds = [...new Set(items.map((item) => item.parentId).filter(Boolean))];
  const sprintIds = [...new Set([action.sprintId, ...items.map((item) => item.sprintId).filter(Boolean)])];
  const [parents, sprints] = await Promise.all([
    parentIds.length
      ? supabase.from("tasks").select("id,task_type,updated_at,trashed_at,approval_status,status,assignee,owner,parent_task_id,sprint_id").in("id", parentIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from("sprints").select("id,score_locked").in("id", sprintIds),
  ]);
  if (parents.error || sprints.error) return { data: null, error: parents.error || sprints.error };
  return {
    data: {
      kind: "state",
      state: {
        items,
        parents: (Array.isArray(parents.data) ? parents.data : []).map(itemState).filter((item): item is SprintAssignmentItemState => Boolean(item)),
        sprints: (Array.isArray(sprints.data) ? sprints.data : []).map(sprintState).filter((sprint): sprint is SprintState => Boolean(sprint)),
      },
    },
    error: null,
  };
}

function mappedProviderError(code: string, request: PlanningCommitRequest<SprintAssignmentCommitPlan>): PlanningCommitOutcome | null {
  if (code === "P0001") return { ok: false, error: { code: "conflict", reason: "revision" } };
  if (code === "P0002") return { ok: false, error: { code: "notFound", entity: { kind: "deliverable", id: request.plan.assignments[0]?.taskId || "" } } };
  if (code === "P0004") return { ok: false, error: { code: "notFound", entity: { kind: "sprint", id: request.plan.sprintId } } };
  if (code === "P0005") return { ok: false, error: stateConflict("targetSprintLocked") };
  if (code === "P0006") return { ok: false, error: stateConflict("sourceSprintMissing") };
  if (code === "P0007") return { ok: false, error: stateConflict("sourceSprintLocked") };
  if (code === "P0010") return { ok: false, error: invalid("deliverableRequired") };
  if (code === "P0011") return { ok: false, error: stateConflict("approvalRequired") };
  if (code === "P0012") return { ok: false, error: stateConflict("completed") };
  if (code === "P0013") return { ok: false, error: stateConflict("ownerRequired") };
  if (code === "P0014") return { ok: false, error: stateConflict("approvedInitiativeRequired") };
  if (code === "P0015") return { ok: false, error: { code: "forbidden", reason: "sprintAssignmentRequiresOperationalLead" } };
  if (code === "22023" || code === "22007") return { ok: false, error: invalid("invalidSprintAssignment") };
  return null;
}

function updates(value: unknown): SprintAssignmentUpdate[] | null {
  if (!Array.isArray(value)) return null;
  const mapped = value.map((entry) => {
    if (!entry || typeof entry !== "object") return null;
    const row = entry as Record<string, unknown>;
    return typeof row.id === "string" && typeof row.sprintId === "string" && typeof row.updatedAt === "string"
      ? { id: row.id, sprintId: row.sprintId, scoreRelevant: Boolean(row.scoreRelevant), updatedAt: row.updatedAt }
      : null;
  });
  return mapped.every((entry): entry is SprintAssignmentUpdate => Boolean(entry)) ? mapped : null;
}

async function commitSprintAssignment(
  supabase: PlanningSupabase,
  request: PlanningCommitRequest<SprintAssignmentCommitPlan>,
): Promise<{ data: PlanningCommitOutcome | null; error: unknown | null }> {
  const result = await supabase.rpc("assign_backlog_tasks_to_sprint_transaction", {
    p_assignments: request.plan.assignments,
    p_sprint_id: request.plan.sprintId,
    p_actor_profile_id: request.actor.profileId,
    p_request_ip: request.requestMetadata?.requestIp || null,
    p_user_agent: request.requestMetadata?.userAgent || null,
  });
  if (result.error) {
    const mapped = mappedProviderError(String((result.error as { code?: unknown }).code || ""), request);
    return mapped ? { data: mapped, error: null } : { data: null, error: result.error };
  }
  const assignmentUpdates = updates(result.data);
  if (!assignmentUpdates) return { data: null, error: new Error("Invalid Sprint assignment result") };
  return {
    data: {
      ok: true,
      receipt: {
        items: [],
        changes: [{ field: "sprintAssignment", before: null, after: assignmentUpdates }],
        effects: assignmentUpdates.map((update) => ({ kind: "audit", description: `Record Sprint assignment for ${update.id}`, status: "applied" })),
        replayed: false,
      },
    },
    error: null,
  };
}

export function createSprintAssignmentPlanningItems(supabaseClient: unknown): PlanningItems {
  const supabase = supabaseClient as PlanningSupabase;
  return createPlanningItems({
    store: createSupabasePlanningItemsStore<SprintAssignmentState, SprintAssignmentCommitPlan>({
      prepareCommand: (request) => prepareSprintAssignment(supabase, request),
      commitCommand: (request) => commitSprintAssignment(supabase, request),
    }),
    decisionCore: sprintAssignmentDecisionCore,
  });
}

export function sprintAssignmentUpdatesFromChanges(changes: readonly { field: string; after: unknown }[]) {
  return updates(changes.find((change) => change.field === "sprintAssignment")?.after) || [];
}

export function sprintAssignmentError(error: PlanningError): Readonly<{ message: string; status: number }> {
  if (error.code === "invalidCommand") {
    const deliverableOnly = error.issues.some((issue) => issue.reason === "deliverableRequired");
    return { message: deliverableOnly ? "Nur Deliverables können einem Sprint zugeordnet werden." : "Sprint-Zuordnung ist ungültig.", status: 400 };
  }
  if (error.code === "forbidden") return { message: "Nur CEO oder Deputy können Sprint-Zuordnungen ändern.", status: 403 };
  if (error.code === "notFound") {
    return error.entity.kind === "sprint"
      ? { message: "Sprint wurde nicht gefunden.", status: 404 }
      : { message: "Mindestens ein Deliverable wurde nicht gefunden.", status: 404 };
  }
  if (error.code === "conflict" && error.reason === "revision") {
    return { message: "Mindestens ein Deliverable wurde zwischenzeitlich geändert. Bitte neu laden.", status: 409 };
  }
  if (error.code === "conflict") {
    const reason = String(error.details?.sprintAssignmentReason || "");
    const messages: Record<string, string> = {
      targetSprintLocked: "Der Ziel-Sprint ist gesperrt.",
      sourceSprintMissing: "Ein bisheriger Sprint wurde nicht gefunden. Bitte neu laden.",
      sourceSprintLocked: "Deliverables aus einem gesperrten Sprint können nicht umgeplant werden.",
      approvalRequired: "Nur freigegebene Deliverables können einem Sprint zugeordnet werden.",
      completed: "Erledigte Deliverables können nicht mehr einem Sprint zugeordnet werden.",
      ownerRequired: "Für mindestens ein Deliverable fehlt die Zuständigkeit.",
      approvedInitiativeRequired: "Für mindestens ein Deliverable fehlt eine freigegebene Initiative.",
    };
    return { message: messages[reason] || "Sprint-Zuordnungen konnten nicht gespeichert werden.", status: 409 };
  }
  return { message: "Sprint-Zuordnungen konnten nicht gespeichert werden.", status: 500 };
}
