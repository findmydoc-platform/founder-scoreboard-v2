import "server-only";

import { createPlanningItems, type PlanningDecisionCore } from "./planning-items-runner";
import { createSupabasePlanningItemsStore } from "./planning-items-store-supabase";
import type {
  ActOnItem,
  PlanningAction,
  PlanningError,
  PlanningItems,
  PlanningResult,
} from "./planning-items";
import type {
  PlanningCommitOutcome,
  PlanningCommitRequest,
  PlanningPreparation,
  PlanningPreparationRequest,
} from "./planning-items-store";

export type PlanningRelationshipType = "blocked_by" | "blocks" | "relates_to";

export type PlanningRelationship = Readonly<{
  id: number;
  taskId: string;
  relatedTaskId: string;
  relationType: PlanningRelationshipType;
  note: string;
  createdBy: string;
  createdAt: string;
}>;

export type AddPlanningRelationshipPayload = Readonly<{
  relationType: PlanningRelationshipType;
  relatedTaskId: string;
  note: string;
  expectedUpdatedAt?: string;
}>;

export type RemovePlanningRelationshipPayload = Readonly<{
  relationId: number;
  expectedUpdatedAt?: string;
}>;

type RelationshipTaskState = Readonly<{
  id: string;
  kind: string;
  revision: string;
  owner: string;
  assignee: string;
  parentId: string;
  trashed: boolean;
}>;

type RelationshipInitiativeState = Readonly<{
  ownerId: string;
  accountableProfileId: string;
}>;

export type PlanningRelationshipState = Readonly<{
  source: RelationshipTaskState | null;
  related: RelationshipTaskState | null;
  relation: PlanningRelationship | null;
  existingRelation: PlanningRelationship | null;
  initiative: RelationshipInitiativeState | null;
  actorName: string;
  reviewLocked: boolean;
  finalReviewLocked: boolean;
}>;

export type PlanningRelationshipCommitPlan = Readonly<{
  operation: "add" | "remove";
  taskId: string;
  relatedTaskId: string | null;
  relationType: PlanningRelationshipType | null;
  relationId: number | null;
  note: string;
  expectedRevision: string | null;
}>;

type QueryResult = Readonly<{ data: unknown; error: unknown | null }>;
type PlanningSupabase = Readonly<{
  rpc(name: string, params: Readonly<Record<string, unknown>>): Promise<QueryResult>;
}>;

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Boolean(value) && !Number.isNaN(Date.parse(value));
}

function optionalExpectedRevision(value: unknown) {
  if (value === undefined || value === null || value === "") return { ok: true as const, value: undefined };
  return validTimestamp(value)
    ? { ok: true as const, value }
    : { ok: false as const };
}

export function parseAddPlanningRelationshipPayload(payload: unknown):
  | Readonly<{ ok: true; value: AddPlanningRelationshipPayload }>
  | Readonly<{ ok: false; error: string }> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Ungültige Abhängigkeitsart." };
  }
  const record = payload as Record<string, unknown>;
  const relationType = record.relationType;
  if (relationType !== "blocked_by" && relationType !== "blocks" && relationType !== "relates_to") {
    return { ok: false, error: "Ungültige Abhängigkeitsart." };
  }
  const relatedTaskId = typeof record.relatedTaskId === "string" ? record.relatedTaskId.trim() : "";
  if (!relatedTaskId) return { ok: false, error: "Bitte eine andere Aufgabe auswählen." };
  const expected = optionalExpectedRevision(record.expectedUpdatedAt);
  if (!expected.ok) return { ok: false, error: "expectedUpdatedAt muss ein gültiger Zeitstempel sein." };
  return {
    ok: true,
    value: {
      relationType,
      relatedTaskId,
      note: typeof record.note === "string" ? record.note.trim().slice(0, 500) : "",
      ...(expected.value ? { expectedUpdatedAt: expected.value } : {}),
    },
  };
}

export function parseRemovePlanningRelationshipPayload(payload: unknown):
  | Readonly<{ ok: true; value: RemovePlanningRelationshipPayload }>
  | Readonly<{ ok: false; error: string }> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Abhängigkeit ist erforderlich." };
  }
  const record = payload as Record<string, unknown>;
  const relationId = Number(record.relationId);
  if (!Number.isInteger(relationId) || relationId <= 0) {
    return { ok: false, error: "Abhängigkeit ist erforderlich." };
  }
  const expected = optionalExpectedRevision(record.expectedUpdatedAt);
  if (!expected.ok) return { ok: false, error: "expectedUpdatedAt muss ein gültiger Zeitstempel sein." };
  return {
    ok: true,
    value: { relationId, ...(expected.value ? { expectedUpdatedAt: expected.value } : {}) },
  };
}

export function addPlanningRelationshipCommand(
  taskId: string,
  payload: AddPlanningRelationshipPayload,
): ActOnItem {
  return {
    kind: "actOnItem",
    action: {
      kind: "addRelationship",
      itemId: taskId,
      relatedItemId: payload.relatedTaskId,
      relation: payload.relationType,
      ...(payload.note ? { note: payload.note } : {}),
      ...(payload.expectedUpdatedAt ? { expectedRevision: payload.expectedUpdatedAt } : {}),
    },
  };
}

export function removePlanningRelationshipCommand(
  taskId: string,
  payload: RemovePlanningRelationshipPayload,
): ActOnItem {
  return {
    kind: "actOnItem",
    action: {
      kind: "removeRelationship",
      itemId: taskId,
      relationshipId: payload.relationId,
      ...(payload.expectedUpdatedAt ? { expectedRevision: payload.expectedUpdatedAt } : {}),
    },
  };
}

type AddRelationshipAction = Extract<PlanningAction, { kind: "addRelationship" }>;
type RemoveRelationshipAction = Extract<PlanningAction, { kind: "removeRelationship" }>;

function relationshipAction(command: ActOnItem): AddRelationshipAction | RemoveRelationshipAction | null {
  return command.action.kind === "addRelationship" || command.action.kind === "removeRelationship"
    ? command.action
    : null;
}

function invalid(reason: string): PlanningError {
  return { code: "invalidCommand", issues: [{ path: "command.action", reason }] };
}

function stateConflict(reason: string): PlanningError {
  return { code: "conflict", reason: "state", details: { planningRelationshipReason: reason } };
}

function ownedByActor(state: PlanningRelationshipState, profileId: string) {
  const aliases = new Set([profileId, state.actorName].filter(Boolean));
  return Boolean(
    state.source
    && (aliases.has(state.source.owner) || aliases.has(state.source.assignee)),
  );
}

function accountableToActor(state: PlanningRelationshipState, profileId: string) {
  return state.initiative?.accountableProfileId === profileId
    || (!state.initiative?.accountableProfileId && state.initiative?.ownerId === profileId);
}

function canManageBlockedBy(state: PlanningRelationshipState, profileId: string, platformRole: string) {
  return platformRole === "founder"
    && Boolean(state.source && (state.source.kind === "deliverable" || state.source.kind === "sub_issue"))
    && (ownedByActor(state, profileId) || accountableToActor(state, profileId));
}

function relationChange(operation: "add" | "remove", relation: PlanningRelationship) {
  return {
    field: "planningRelationship",
    before: operation === "remove" ? relation : null,
    after: operation === "add" ? relation : null,
  } as const;
}

export const planningRelationshipDecisionCore: PlanningDecisionCore<
  PlanningRelationshipState,
  PlanningRelationshipCommitPlan
> = {
  decide({ actor, command, state }) {
    if (command.kind !== "actOnItem") return { ok: false, error: invalid("planningRelationshipRequired") };
    const action = relationshipAction(command);
    if (!action) return { ok: false, error: invalid("planningRelationshipRequired") };
    if (!state.source) return { ok: false, error: { code: "notFound", entity: { kind: "deliverable", id: action.itemId } } };
    if (state.source.trashed) return { ok: false, error: stateConflict("sourceTrashed") };
    if (action.expectedRevision && state.source.revision !== action.expectedRevision) {
      return { ok: false, error: { code: "conflict", reason: "revision" } };
    }
    if (actor.platformRole === "viewer") {
      return { ok: false, error: { code: "forbidden", reason: "planningRelationshipRequiresContributor" } };
    }
    if (state.reviewLocked) return { ok: false, error: stateConflict(state.finalReviewLocked ? "finalReviewLocked" : "reviewLocked") };

    const canManageAll = actor.platformRole === "ceo" || actor.platformRole === "deputy";
    const canManageDependency = canManageBlockedBy(state, actor.profileId, actor.platformRole);

    if (action.kind === "addRelationship") {
      if (action.relatedItemId === action.itemId) return { ok: false, error: invalid("selfRelationship") };
      if (!state.related) return { ok: false, error: { code: "notFound", entity: { kind: "deliverable", id: action.relatedItemId } } };
      if (state.related.trashed) return { ok: false, error: stateConflict("relatedTrashed") };
      if (!canManageAll && !(canManageDependency && action.relation === "blocked_by")) {
        return { ok: false, error: { code: "forbidden", reason: "planningRelationshipMutationForbidden" } };
      }
      if (state.existingRelation) return { ok: false, error: stateConflict("duplicate") };
      const planned: PlanningRelationship = {
        id: 0,
        taskId: action.itemId,
        relatedTaskId: action.relatedItemId,
        relationType: action.relation,
        note: action.note || "",
        createdBy: actor.profileId,
        createdAt: "",
      };
      return {
        ok: true,
        items: [],
        changes: [relationChange("add", planned)],
        effects: [
          { kind: "audit", description: "Record planning relationship creation" },
          { kind: "githubProjection", description: "Mark affected GitHub projections stale" },
        ],
        warnings: [],
        commitPlan: {
          operation: "add",
          taskId: action.itemId,
          relatedTaskId: action.relatedItemId,
          relationType: action.relation,
          relationId: null,
          note: action.note || "",
          expectedRevision: action.expectedRevision || null,
        },
      };
    }

    if (!state.relation) {
      return { ok: false, error: { code: "notFound", entity: { kind: "relationship", id: String(action.relationshipId) } } };
    }
    if (state.relation.taskId !== action.itemId && state.relation.relatedTaskId !== action.itemId) {
      return { ok: false, error: { code: "forbidden", reason: "planningRelationshipDoesNotBelongToItem" } };
    }
    if (!state.related) return { ok: false, error: { code: "notFound", entity: { kind: "deliverable", id: "" } } };
    if (state.related.trashed) return { ok: false, error: stateConflict("relatedTrashed") };
    if (!canManageAll && !(
      canManageDependency
      && state.relation.taskId === action.itemId
      && state.relation.relationType === "blocked_by"
    )) {
      return { ok: false, error: { code: "forbidden", reason: "planningRelationshipMutationForbidden" } };
    }
    return {
      ok: true,
      items: [],
      changes: [relationChange("remove", state.relation)],
      effects: [
        { kind: "audit", description: "Record planning relationship removal" },
        { kind: "githubProjection", description: "Mark affected GitHub projections stale" },
      ],
      warnings: [],
      commitPlan: {
        operation: "remove",
        taskId: action.itemId,
        relatedTaskId: null,
        relationType: null,
        relationId: action.relationshipId,
        note: "",
        expectedRevision: action.expectedRevision || null,
      },
    };
  },
};

function taskState(value: unknown): RelationshipTaskState | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : "";
  if (!id) return null;
  return {
    id,
    kind: String(row.task_type || ""),
    revision: String(row.updated_at || ""),
    owner: String(row.owner || ""),
    assignee: String(row.assignee || ""),
    parentId: String(row.parent_task_id || ""),
    trashed: Boolean(row.trashed_at),
  };
}

function relationship(value: unknown): PlanningRelationship | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = Number(row.id);
  const relationType = row.relation_type || row.relationType;
  if (!Number.isInteger(id) || id <= 0 || (relationType !== "blocked_by" && relationType !== "blocks" && relationType !== "relates_to")) {
    return null;
  }
  return {
    id,
    taskId: String(row.task_id || row.taskId || ""),
    relatedTaskId: String(row.related_task_id || row.relatedTaskId || ""),
    relationType,
    note: String(row.note || ""),
    createdBy: String(row.created_by || row.createdBy || ""),
    createdAt: String(row.created_at || row.createdAt || ""),
  };
}

function preparationState(value: unknown): PlanningRelationshipState | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const initiativeRow = row.initiative && typeof row.initiative === "object"
    ? row.initiative as Record<string, unknown>
    : null;
  return {
    source: taskState(row.source),
    related: taskState(row.related),
    relation: relationship(row.relation),
    existingRelation: relationship(row.existingRelation),
    actorName: String(row.actorName || ""),
    initiative: initiativeRow ? {
      ownerId: String(initiativeRow.ownerId || ""),
      accountableProfileId: String(initiativeRow.accountableProfileId || ""),
    } : null,
    reviewLocked: Boolean(row.reviewLocked),
    finalReviewLocked: Boolean(row.finalReviewLocked),
  };
}

async function prepareRelationship(
  supabase: PlanningSupabase,
  request: PlanningPreparationRequest,
): Promise<{ data: PlanningPreparation<PlanningRelationshipState> | null; error: unknown | null }> {
  if (request.command.kind !== "actOnItem") {
    return { data: { kind: "error", error: invalid("planningRelationshipRequired") }, error: null };
  }
  const action = relationshipAction(request.command);
  if (!action) return { data: { kind: "error", error: invalid("planningRelationshipRequired") }, error: null };
  const result = await supabase.rpc("prepare_planning_relationship_command", {
    p_task_id: action.itemId,
    p_related_task_id: action.kind === "addRelationship" ? action.relatedItemId : null,
    p_relation_id: action.kind === "removeRelationship" ? action.relationshipId : null,
    p_relation_type: action.kind === "addRelationship" ? action.relation : null,
    p_actor_profile_id: request.actor.profileId,
  });
  if (result.error) return { data: null, error: result.error };
  const state = preparationState(result.data);
  return state ? { data: { kind: "state", state }, error: null } : { data: null, error: new Error("Invalid planning relationship state") };
}

function providerError(code: string, request: PlanningCommitRequest<PlanningRelationshipCommitPlan>): PlanningCommitOutcome | null {
  if (code === "P0001") return { ok: false, error: { code: "conflict", reason: "revision" } };
  if (code === "P0002") {
    const entity = request.plan.operation === "remove" && request.plan.relationId
      ? { kind: "relationship" as const, id: String(request.plan.relationId) }
      : { kind: "deliverable" as const, id: request.plan.relatedTaskId || request.plan.taskId };
    return { ok: false, error: { code: "notFound", entity } };
  }
  if (code === "P0003") return { ok: false, error: stateConflict("duplicate") };
  if (code === "P0006") return { ok: false, error: { code: "forbidden", reason: "planningRelationshipAuthorizationChanged" } };
  if (code === "P0008") return { ok: false, error: stateConflict("reviewLocked") };
  if (code === "P0010") return { ok: false, error: stateConflict("sourceTrashed") };
  if (code === "P0011") return { ok: false, error: stateConflict("relatedTrashed") };
  if (code === "22023" || code === "23514") return { ok: false, error: invalid("invalidPlanningRelationship") };
  return null;
}

async function commitRelationship(
  supabase: PlanningSupabase,
  request: PlanningCommitRequest<PlanningRelationshipCommitPlan>,
): Promise<{ data: PlanningCommitOutcome | null; error: unknown | null }> {
  const result = await supabase.rpc("mutate_planning_relationship_transaction", {
    p_operation: request.plan.operation,
    p_task_id: request.plan.taskId,
    p_related_task_id: request.plan.relatedTaskId,
    p_relation_type: request.plan.relationType,
    p_relation_id: request.plan.relationId,
    p_note: request.plan.note,
    p_expected_updated_at: request.plan.expectedRevision,
    p_actor_profile_id: request.actor.profileId,
    p_request_ip: request.requestMetadata?.requestIp || null,
    p_user_agent: request.requestMetadata?.userAgent || null,
  });
  if (result.error) {
    const mapped = providerError(String((result.error as { code?: unknown }).code || ""), request);
    return mapped ? { data: mapped, error: null } : { data: null, error: result.error };
  }
  if (!result.data || typeof result.data !== "object") return { data: null, error: new Error("Invalid planning relationship result") };
  const transaction = result.data as Record<string, unknown>;
  const committedRelation = relationship(transaction.relation);
  if (!committedRelation) return { data: null, error: new Error("Planning relationship result is incomplete") };
  return {
    data: {
      ok: true,
      receipt: {
        items: [],
        changes: [relationChange(request.plan.operation, committedRelation)],
        effects: [
          {
            kind: "audit",
            description: request.plan.operation === "add"
              ? "Record planning relationship creation"
              : "Record planning relationship removal",
            status: "applied",
          },
          { kind: "githubProjection", description: "Mark affected GitHub projections stale", status: "applied" },
        ],
        replayed: false,
      },
    },
    error: null,
  };
}

export function createPlanningRelationshipPlanningItems(supabaseClient: unknown): PlanningItems {
  const supabase = supabaseClient as PlanningSupabase;
  return createPlanningItems({
    store: createSupabasePlanningItemsStore<PlanningRelationshipState, PlanningRelationshipCommitPlan>({
      prepareCommand: (request) => prepareRelationship(supabase, request),
      commitCommand: (request) => commitRelationship(supabase, request),
    }),
    decisionCore: planningRelationshipDecisionCore,
  });
}

export function planningRelationshipFromResult(result: Extract<PlanningResult, { ok: true }>) {
  const change = result.changes.find((candidate) => candidate.field === "planningRelationship");
  return relationship(change?.after || change?.before);
}

export function planningRelationshipError(error: PlanningError): Readonly<{ message: string; status: number }> {
  if (error.code === "invalidCommand") {
    const self = error.issues.some((issue) => issue.reason === "selfRelationship");
    return { message: self ? "Bitte eine andere Aufgabe auswählen." : "Ungültige Abhängigkeitsart.", status: 400 };
  }
  if (error.code === "forbidden") {
    if (error.reason === "planningRelationshipDoesNotBelongToItem") {
      return { message: "Abhängigkeit gehört nicht zu dieser Aufgabe.", status: 403 };
    }
    return { message: "Nur Owner, Accountable, CEO oder Deputy können diese Blocker-Abhängigkeit verwalten.", status: 403 };
  }
  if (error.code === "notFound") {
    return error.entity.kind === "relationship"
      ? { message: "Abhängigkeit wurde nicht gefunden.", status: 404 }
      : { message: "Aufgabe wurde nicht gefunden.", status: 404 };
  }
  if (error.code === "conflict" && error.reason === "revision") {
    return { message: "Aufgabe wurde zwischenzeitlich geändert. Bitte neu laden.", status: 409 };
  }
  if (error.code === "conflict") {
    const reason = String(error.details?.planningRelationshipReason || "");
    if (reason === "duplicate") return { message: "Diese Abhängigkeit existiert bereits.", status: 409 };
    if (reason === "sourceTrashed" || reason === "relatedTrashed") {
      return { message: "Aufgabe befindet sich im Papierkorb und kann nicht geändert werden.", status: 409 };
    }
    if (reason === "finalReviewLocked") {
      return { message: "Dieses Issue ist nach dem finalen Review geschützt. Öffne das Review erneut, bevor du den Inhalt änderst.", status: 409 };
    }
    return { message: "Dieses Issue ist während des aktiven Reviews geschützt. Schließe das Review ab oder ziehe es mit Begründung zurück.", status: 409 };
  }
  return { message: "Abhängigkeit konnte nicht gespeichert werden.", status: 500 };
}
