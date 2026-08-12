import "server-only";

import { createHash } from "node:crypto";
import type { Epic, StrategicPlanningStatus } from "./planning-item-domain";
import { createPlanningItems, type PlanningDecisionCore } from "./planning-items-runner";
import { createSupabasePlanningItemsStore } from "./planning-items-store-supabase";
import type { ActOnItem, PlanningAction, PlanningError, PlanningItems, PlanningResult } from "./planning-items";
import type {
  PlanningCommitOutcome,
  PlanningCommitRequest,
  PlanningPreparation,
  PlanningPreparationRequest,
} from "./planning-items-store";

export const EMPTY_EPIC_DELETE_WARNING = "Zugeordnete Initiativen oder Aufgaben werden weder verschoben noch gelöscht.";

export type EmptyEpicChildren = Readonly<{ initiatives: number; tasks: number }>;

type EmptyEpicDeleteProjection = Readonly<{
  itemType: "epic" | "milestone";
  sortOrder: number;
  children: EmptyEpicChildren;
  contractVersion: number;
}>;

export type EmptyEpicDeleteState = Readonly<{
  item: Epic | null;
  projection: EmptyEpicDeleteProjection | null;
  legacyProtected: boolean;
}>;

export type EmptyEpicDeleteCommitPlan = Readonly<{
  requestedItemId: string;
  itemId: string;
  expectedRevision: string;
  item: Epic;
  projection: EmptyEpicDeleteProjection;
  canDelete: boolean;
}>;

type QueryResult = Readonly<{ data: unknown; error: unknown | null }>;
type QueryBuilder = {
  select(columns: string): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  maybeSingle(): Promise<QueryResult>;
};
type PlanningSupabase = Readonly<{
  from(table: string): QueryBuilder;
  rpc(name: string, params: Readonly<Record<string, unknown>>): Promise<QueryResult>;
}>;

type DeleteTransaction = Readonly<{
  replayed?: boolean;
  itemType?: "epic" | "milestone";
  item?: Record<string, unknown>;
  task?: Record<string, unknown>;
  children?: Partial<EmptyEpicChildren>;
}>;

function invalid(reason: string): PlanningError {
  return { code: "invalidCommand", issues: [{ path: "command.action", reason }] };
}

function deleteAction(command: ActOnItem): Extract<PlanningAction, { kind: "deleteEmptyEpic" }> | null {
  return command.action.kind === "deleteEmptyEpic" ? command.action : null;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && Boolean(value) && !Number.isNaN(Date.parse(value));
}

export function parseEmptyEpicDeletePayload(payload: unknown):
  | Readonly<{ ok: true; expectedUpdatedAt: string }>
  | Readonly<{ ok: false; error: string }> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Ungültiger JSON-Body." };
  }
  const record = payload as Record<string, unknown>;
  const unknown = Object.keys(record).filter((field) => field !== "expectedUpdatedAt");
  if (unknown.length) return { ok: false, error: `Unbekanntes Feld: ${unknown.join(", ")}.` };
  if (!validTimestamp(record.expectedUpdatedAt)) {
    return { ok: false, error: "expectedUpdatedAt muss ein gültiger Zeitstempel sein." };
  }
  return { ok: true, expectedUpdatedAt: record.expectedUpdatedAt };
}

export function emptyEpicDeleteHash({ itemId, expectedUpdatedAt }: { itemId: string; expectedUpdatedAt: string }) {
  return createHash("sha256")
    .update(JSON.stringify({ itemId, expectedUpdatedAt }), "utf8")
    .digest("hex");
}

export function emptyEpicDeleteCommand(itemId: string, expectedUpdatedAt: string): ActOnItem {
  return {
    kind: "actOnItem",
    action: { kind: "deleteEmptyEpic", itemId, expectedRevision: expectedUpdatedAt },
  };
}

function strategicStatus(value: unknown): StrategicPlanningStatus {
  return ["Offen", "In Arbeit", "Pausiert", "Blockiert", "Erledigt"].includes(String(value))
    ? String(value) as StrategicPlanningStatus
    : "Offen";
}

function epicFromRow(value: unknown): Epic | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id : "";
  const revision = typeof row.updated_at === "string" ? row.updated_at : "";
  if (!id || !revision) return null;
  return {
    id,
    kind: "epic",
    title: String(row.title || ""),
    description: String(row.description || ""),
    ownerId: typeof row.owner === "string" && row.owner ? row.owner : null,
    status: strategicStatus(row.status),
    targetDate: typeof row.target_date === "string" && row.target_date ? row.target_date : null,
    revision,
    createdAt: typeof row.created_at === "string" ? row.created_at : revision,
    updatedAt: revision,
  };
}

function projectionFromRow(
  value: unknown,
  children: EmptyEpicChildren,
  itemType: "epic" | "milestone" = "epic",
  contractVersion = 2,
): EmptyEpicDeleteProjection | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  return { itemType, sortOrder: Number(row.sort_order || 0), children, contractVersion };
}

function deleteMetadata(projection: EmptyEpicDeleteProjection) {
  return { field: "emptyEpicDelete", before: projection, after: null } as const;
}

export const emptyEpicDeleteDecisionCore: PlanningDecisionCore<EmptyEpicDeleteState, EmptyEpicDeleteCommitPlan> = {
  decide({ actor, command, state }) {
    if (command.kind !== "actOnItem") return { ok: false, error: invalid("deleteEmptyEpicRequired") };
    const action = deleteAction(command);
    if (!action) return { ok: false, error: invalid("deleteEmptyEpicRequired") };
    if (actor.platformRole !== "ceo" && actor.platformRole !== "deputy") {
      return { ok: false, error: { code: "forbidden", reason: "emptyEpicDeleteRequiresOperationalLead" } };
    }
    if (
      actor.credential.kind === "planningToken"
      && !actor.credential.scopes.includes("write:planning-items:delete-empty")
    ) {
      return { ok: false, error: { code: "forbidden", reason: "emptyEpicDeleteScopeRequired" } };
    }
    if (!state.item || !state.projection) {
      return { ok: false, error: { code: "notFound", entity: { kind: "epic", id: action.itemId } } };
    }
    if (state.item.revision !== action.expectedRevision) {
      return { ok: false, error: { code: "conflict", reason: "revision" } };
    }
    const children = state.projection.children;
    const canDelete = !state.legacyProtected && children.initiatives === 0 && children.tasks === 0;
    return {
      ok: true,
      items: [state.item],
      changes: [deleteMetadata(state.projection)],
      effects: canDelete ? [{ kind: "audit", description: "Record empty Epic deletion" }] : [],
      warnings: [{ code: "emptyEpicDeleteScope", message: EMPTY_EPIC_DELETE_WARNING }],
      commitPlan: {
        requestedItemId: action.itemId,
        itemId: state.item.id,
        expectedRevision: action.expectedRevision,
        item: state.item,
        projection: state.projection,
        canDelete,
      },
    };
  },
};

async function loadDeleteState(supabase: PlanningSupabase, candidateId: string): Promise<{
  state: EmptyEpicDeleteState | null;
  error: unknown | null;
}> {
  const prepared = await supabase.rpc("prepare_empty_epic_delete", { p_item_id: candidateId });
  if (prepared.error) return { state: null, error: prepared.error };
  if (!prepared.data || typeof prepared.data !== "object") return { state: null, error: new Error("Invalid empty Epic delete state") };
  const value = prepared.data as Record<string, unknown>;
  const item = epicFromRow(value.item);
  if (!item) return { state: { item: null, projection: null, legacyProtected: false }, error: null };
  const rawChildren = value.children && typeof value.children === "object"
    ? value.children as Record<string, unknown>
    : {};
  const children = {
    initiatives: Number(rawChildren.initiatives || 0),
    tasks: Number(rawChildren.tasks || 0),
  };
  const projection = projectionFromRow(value.item, children);
  return {
    state: {
      item,
      projection,
      legacyProtected: Boolean(value.legacyProtected),
    },
    error: null,
  };
}

function replayReceipt(value: unknown, contractVersion: number): PlanningPreparation<EmptyEpicDeleteState> | null {
  if (!value || typeof value !== "object") return null;
  const transaction = value as DeleteTransaction;
  const row = transaction.item || transaction.task;
  const item = epicFromRow(row);
  const children = {
    initiatives: Number(transaction.children?.initiatives || 0),
    tasks: Number(transaction.children?.tasks || 0),
  };
  const itemType = transaction.itemType === "milestone" ? "milestone" : "epic";
  const projection = projectionFromRow(row, children, itemType, contractVersion);
  if (!item || !projection) return null;
  return {
    kind: "replay",
    receipt: {
      items: [item],
      changes: [deleteMetadata(projection)],
      effects: [{ kind: "audit", description: "Record empty Epic deletion", status: "applied" }],
      replayed: false,
    },
  };
}

async function prepareDelete(
  supabase: PlanningSupabase,
  request: PlanningPreparationRequest,
): Promise<{ data: PlanningPreparation<EmptyEpicDeleteState> | null; error: unknown | null }> {
  if (request.command.kind !== "actOnItem") {
    return { data: { kind: "error", error: invalid("deleteEmptyEpicRequired") }, error: null };
  }
  const action = deleteAction(request.command);
  if (!action) return { data: { kind: "error", error: invalid("deleteEmptyEpicRequired") }, error: null };
  if (request.actor.credential.kind === "planningToken" && request.idempotencyKey) {
    const stored = await supabase.from("team_planning_milestone_delete_requests")
      .select("request_hash,response,contract_version")
      .eq("token_id", request.actor.credential.tokenId)
      .eq("idempotency_key", request.idempotencyKey)
      .maybeSingle();
    if (stored.error) return { data: null, error: stored.error };
    if (stored.data && typeof stored.data === "object") {
      const row = stored.data as Record<string, unknown>;
      const expectedHash = emptyEpicDeleteHash({ itemId: action.itemId, expectedUpdatedAt: action.expectedRevision });
      if (row.request_hash !== expectedHash) {
        return { data: { kind: "error", error: { code: "conflict", reason: "idempotency" } }, error: null };
      }
      const replay = replayReceipt(row.response, Number(row.contract_version || 1));
      return replay ? { data: replay, error: null } : { data: null, error: new Error("Invalid stored empty Epic delete receipt") };
    }
  }
  const loaded = await loadDeleteState(supabase, action.itemId);
  return loaded.error ? { data: null, error: loaded.error } : { data: { kind: "state", state: loaded.state! }, error: null };
}

function conflictForPlan(plan: EmptyEpicDeleteCommitPlan): PlanningCommitOutcome {
  return {
    ok: false,
    error: {
      code: "conflict",
      reason: "state",
      details: { emptyEpicDeleteReason: "notEmpty", children: plan.projection.children },
    },
  };
}

async function mappedProviderError(
  supabase: PlanningSupabase,
  code: string,
  request: PlanningCommitRequest<EmptyEpicDeleteCommitPlan>,
): Promise<PlanningCommitOutcome | null> {
  if (code === "P0001") return { ok: false, error: { code: "conflict", reason: "revision" } };
  if (code === "P0002") return { ok: false, error: { code: "notFound", entity: { kind: "epic", id: request.plan.itemId } } };
  if (code === "P0003") return { ok: false, error: { code: "conflict", reason: "idempotency" } };
  if (code === "P0004") return { ok: false, error: { code: "forbidden", reason: "emptyEpicDeleteTokenInactive" } };
  if (code === "P0005" || code === "P0006") {
    return { ok: false, error: { code: "forbidden", reason: "emptyEpicDeleteAuthorizationChanged" } };
  }
  if (code === "P0008" || code === "23503") {
    const fresh = await loadDeleteState(supabase, request.plan.itemId);
    const children = fresh.state?.projection?.children || request.plan.projection.children;
    return {
      ok: false,
      error: { code: "conflict", reason: "state", details: { emptyEpicDeleteReason: "notEmpty", children } },
    };
  }
  if (code === "22023" || code === "22007") return { ok: false, error: invalid("invalidEmptyEpicDelete") };
  return null;
}

async function commitDelete(
  supabase: PlanningSupabase,
  request: PlanningCommitRequest<EmptyEpicDeleteCommitPlan>,
): Promise<{ data: PlanningCommitOutcome | null; error: unknown | null }> {
  if (!request.plan.canDelete) return { data: conflictForPlan(request.plan), error: null };
  const token = request.actor.credential.kind === "planningToken" ? request.actor.credential : null;
  const metadata = request.requestMetadata;
  const result = token
    ? await supabase.rpc("delete_team_planning_milestone_transaction", {
        p_token_id: token.tokenId,
        p_profile_id: request.actor.profileId,
        p_milestone_id: request.plan.itemId,
        p_expected_updated_at: request.plan.expectedRevision,
        p_idempotency_key: request.idempotencyKey || null,
        p_request_hash: emptyEpicDeleteHash({ itemId: request.plan.requestedItemId, expectedUpdatedAt: request.plan.expectedRevision }),
        p_request_ip: metadata?.requestIp || null,
        p_user_agent: metadata?.userAgent || null,
      })
    : await supabase.rpc("delete_empty_epic_with_audit_transaction", {
        p_task_id: request.plan.itemId,
        p_expected_updated_at: request.plan.expectedRevision,
        p_actor_profile_id: request.actor.profileId,
        p_request_ip: metadata?.requestIp || null,
        p_user_agent: metadata?.userAgent || null,
      });
  if (result.error) {
    const mapped = await mappedProviderError(supabase, String((result.error as { code?: unknown }).code || ""), request);
    return mapped ? { data: mapped, error: null } : { data: null, error: result.error };
  }
  const transaction = result.data as DeleteTransaction | null;
  const row = transaction?.item || transaction?.task;
  const item = epicFromRow(row);
  const children = {
    initiatives: Number(transaction?.children?.initiatives || 0),
    tasks: Number(transaction?.children?.tasks || 0),
  };
  const projection = projectionFromRow(row, children, transaction?.itemType === "milestone" ? "milestone" : "epic", 2);
  if (!item || !projection) return { data: null, error: new Error("Invalid empty Epic delete result") };
  return {
    data: {
      ok: true,
      receipt: {
        items: [item],
        changes: [deleteMetadata(projection)],
        effects: [{ kind: "audit", description: "Record empty Epic deletion", status: "applied" }],
        replayed: Boolean(transaction?.replayed),
      },
    },
    error: null,
  };
}

export function createEmptyEpicDeletePlanningItems(supabaseClient: unknown): PlanningItems {
  const supabase = supabaseClient as PlanningSupabase;
  return createPlanningItems({
    store: createSupabasePlanningItemsStore<EmptyEpicDeleteState, EmptyEpicDeleteCommitPlan>({
      prepareCommand: (request) => prepareDelete(supabase, request),
      commitCommand: (request) => commitDelete(supabase, request),
    }),
    decisionCore: emptyEpicDeleteDecisionCore,
  });
}

function projectionFromResult(result: Extract<PlanningResult, { ok: true }>) {
  const value = result.changes.find((change) => change.field === "emptyEpicDelete")?.before;
  if (!value || typeof value !== "object") return null;
  const projection = value as Partial<EmptyEpicDeleteProjection>;
  if (!projection.children) return null;
  return {
    itemType: projection.itemType === "milestone" ? "milestone" as const : "epic" as const,
    sortOrder: Number(projection.sortOrder || 0),
    children: {
      initiatives: Number(projection.children.initiatives || 0),
      tasks: Number(projection.children.tasks || 0),
    },
    contractVersion: Number(projection.contractVersion || 2),
  };
}

export function emptyEpicDeleteTeamItem(result: Extract<PlanningResult, { ok: true }>) {
  const item = result.items[0];
  const projection = projectionFromResult(result);
  if (!item || item.kind !== "epic" || !projection) return null;
  return {
    itemType: projection.itemType,
    item: {
      id: item.id,
      itemType: projection.itemType,
      title: item.title,
      description: item.description,
      targetDate: item.targetDate || "",
      status: item.status,
      ownerId: item.ownerId || "",
      sortOrder: projection.sortOrder,
      approvalStatus: null,
      updatedAt: item.updatedAt,
    },
    children: projection.children,
  };
}

export function emptyEpicDeleteMilestone(result: Extract<PlanningResult, { ok: true }>) {
  const item = result.items[0];
  const projection = projectionFromResult(result);
  if (!item || item.kind !== "epic" || !projection) return null;
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    targetDate: item.targetDate || "",
    status: item.status === "In Arbeit" ? "active" as const : item.status === "Erledigt" ? "done" as const : "planned" as const,
    sortOrder: projection.sortOrder,
    updatedAt: item.updatedAt,
  };
}

export function emptyEpicDeletePreview(result: Extract<PlanningResult, { ok: true }>) {
  const projected = emptyEpicDeleteTeamItem(result);
  if (!projected) return null;
  const canDelete = projected.children.initiatives === 0 && projected.children.tasks === 0
    && result.effects.some((effect) => effect.kind === "audit");
  return {
    itemId: projected.item.id,
    itemType: "epic" as const,
    expectedUpdatedAt: projected.item.updatedAt,
    // The established preview contract was built from the narrow Milestone
    // select, which intentionally did not expose its owner.
    currentItem: { ...projected.item, itemType: "epic", ownerId: "" },
    children: projected.children,
    valid: canDelete,
    canDelete,
    code: canDelete ? null : "MILESTONE_NOT_EMPTY" as const,
    error: canDelete ? "" : emptyEpicNotEmptyMessage(projected.children),
    warnings: [EMPTY_EPIC_DELETE_WARNING],
  };
}

export function emptyEpicNotEmptyMessage(children: EmptyEpicChildren) {
  const initiativeWord = children.initiatives === 1 ? "Initiative" : "Initiativen";
  const taskWord = children.tasks === 1 ? "Aufgabe" : "Aufgaben";
  return `Der Meilenstein kann nicht gelöscht werden, weil noch ${children.initiatives} ${initiativeWord} und ${children.tasks} ${taskWord} zugeordnet sind.`;
}

export function emptyEpicDeleteError(error: PlanningError): Readonly<{
  message: string;
  status: number;
  code?: "MILESTONE_NOT_EMPTY";
  children?: EmptyEpicChildren;
}> {
  if (error.code === "invalidCommand") return { message: "Planning-Items-Anfrage ist ungültig.", status: 400 };
  if (error.code === "forbidden") {
    if (error.reason === "emptyEpicDeleteTokenInactive") {
      return { message: "Planning-API-Token ist nicht mehr aktiv.", status: 401 };
    }
    if (error.reason === "emptyEpicDeleteAuthorizationChanged" || error.reason === "emptyEpicDeleteScopeRequired") {
      return { message: "Planning-API-Berechtigung ist nicht mehr gültig.", status: 403 };
    }
    return { message: "Nur CEO oder Deputy können Epics löschen.", status: 403 };
  }
  if (error.code === "notFound") return { message: "Epic wurde nicht gefunden.", status: 404 };
  if (error.code === "conflict" && error.reason === "revision") {
    return { message: "Epic wurde zwischenzeitlich geändert. Bitte Kontext erneut laden.", status: 409 };
  }
  if (error.code === "conflict" && error.reason === "idempotency") {
    return { message: "Idempotency-Key wurde mit anderen Daten wiederverwendet.", status: 409 };
  }
  if (error.code === "conflict") {
    const value = error.details?.children;
    const children = value && typeof value === "object"
      ? {
          initiatives: Number((value as Record<string, unknown>).initiatives || 0),
          tasks: Number((value as Record<string, unknown>).tasks || 0),
        }
      : { initiatives: 0, tasks: 0 };
    return { message: emptyEpicNotEmptyMessage(children), status: 409, code: "MILESTONE_NOT_EMPTY", children };
  }
  return { message: "Planning-Items-Löschung konnte nicht gespeichert werden.", status: 500 };
}
