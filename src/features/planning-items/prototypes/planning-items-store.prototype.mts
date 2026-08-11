/**
 * PROTOTYPE — throw away after Wayfinder #286 is settled.
 *
 * Question: Can a two-operation Store (`prepare` + atomic `commit`) let Supabase
 * and in-memory adapters produce the same observable Planning Result without
 * exposing tables, columns, RPC names, or multi-step mutation ordering?
 *
 * This is representative in-memory logic, not production persistence.
 */

export type ItemSnapshot = {
  id: string;
  kind: "epic" | "initiative" | "deliverable" | "sub_issue";
  title: string;
  revision: number;
};

export type PlanningPreparationRequest = {
  commandKind: "createItems" | "reviseItem" | "actOnItem";
  itemIds: readonly string[];
  childCountsFor?: readonly string[];
  replay?: { principalId: string; key: string };
};

export type StoredReplay = {
  fingerprint: string;
  receipt: PlanningCommitReceipt;
};

export type PlanningSnapshot = {
  items: readonly ItemSnapshot[];
  childCounts: Readonly<Record<string, number>>;
};

export type PlanningPreparation =
  | { kind: "state"; snapshot: PlanningSnapshot }
  | { kind: "replay"; replay: StoredReplay };

export type PlanningPrecondition =
  | { kind: "revision"; itemId: string; expected: number }
  | { kind: "absent"; itemId: string }
  | { kind: "empty"; itemId: string };

export type PlanningMutation =
  | { kind: "create"; item: ItemSnapshot }
  | { kind: "revise"; itemId: string; title: string }
  | { kind: "delete"; itemId: string };

export type PlanningEvent =
  | { kind: "activity"; itemId: string; message: string }
  | { kind: "audit"; itemId: string; action: string }
  | { kind: "projectionRequested"; itemId: string };

export type PlanningCommitPlan = {
  commandKind: "createItems" | "reviseItem" | "actOnItem";
  fingerprint: string;
  preconditions: readonly PlanningPrecondition[];
  mutations: readonly PlanningMutation[];
  events: readonly PlanningEvent[];
  idempotency?: { principalId: string; key: string };
  prototypeFailureAfter?: "state";
};

export type PlanningCommitReceipt = {
  status: "committed";
  items: readonly ItemSnapshot[];
  events: readonly PlanningEvent[];
  replayed: boolean;
};

export type PlanningStoreError =
  | { code: "conflict"; reason: "revision" | "idempotency" | "state" }
  | { code: "notFound"; itemId: string }
  | { code: "dependencyUnavailable"; dependency: "database" };

export type PlanningStoreResult =
  | { ok: true; receipt: PlanningCommitReceipt }
  | { ok: false; error: PlanningStoreError };

export interface PlanningItemsStore {
  prepare(request: PlanningPreparationRequest): Promise<PlanningPreparation>;
  commit(plan: PlanningCommitPlan): Promise<PlanningStoreResult>;
}

export type PrototypeDatabase = {
  items: ItemSnapshot[];
  parents: Record<string, string | null>;
  events: PlanningEvent[];
  replays: Record<string, StoredReplay>;
};

export function initialDatabase(): PrototypeDatabase {
  return {
    items: [
      { id: "epic-1", kind: "epic", title: "Launch", revision: 1 },
      { id: "initiative-1", kind: "initiative", title: "Readiness", revision: 1 },
      { id: "deliverable-1", kind: "deliverable", title: "Runbook", revision: 1 },
    ],
    parents: { "epic-1": null, "initiative-1": "epic-1", "deliverable-1": "initiative-1" },
    events: [],
    replays: {},
  };
}

function replayKey(principalId: string, key: string) {
  return `${principalId}:${key}`;
}

function prepare(database: PrototypeDatabase, request: PlanningPreparationRequest): PlanningPreparation {
  if (request.replay) {
    const replay = database.replays[replayKey(request.replay.principalId, request.replay.key)];
    if (replay) return { kind: "replay", replay: structuredClone(replay) };
  }
  const childCounts = Object.fromEntries(
    (request.childCountsFor || []).map((itemId) => [
      itemId,
      Object.values(database.parents).filter((parentId) => parentId === itemId).length,
    ]),
  );
  return {
    kind: "state",
    snapshot: {
      items: database.items.filter((item) => request.itemIds.includes(item.id)).map((item) => ({ ...item })),
      childCounts,
    },
  };
}

function applyPlan(database: PrototypeDatabase, plan: PlanningCommitPlan): PlanningStoreResult {
  if (plan.idempotency) {
    const key = replayKey(plan.idempotency.principalId, plan.idempotency.key);
    const existing = database.replays[key];
    if (existing) {
      if (existing.fingerprint !== plan.fingerprint) {
        return { ok: false, error: { code: "conflict", reason: "idempotency" } };
      }
      return { ok: true, receipt: { ...existing.receipt, replayed: true } };
    }
  }

  for (const precondition of plan.preconditions) {
    const item = database.items.find((candidate) => candidate.id === precondition.itemId);
    if (precondition.kind === "absent" && item) {
      return { ok: false, error: { code: "conflict", reason: "state" } };
    }
    if (precondition.kind !== "absent" && !item) {
      return { ok: false, error: { code: "notFound", itemId: precondition.itemId } };
    }
    if (precondition.kind === "revision" && item?.revision !== precondition.expected) {
      return { ok: false, error: { code: "conflict", reason: "revision" } };
    }
    if (precondition.kind === "empty" && Object.values(database.parents).includes(precondition.itemId)) {
      return { ok: false, error: { code: "conflict", reason: "state" } };
    }
  }

  const affected: ItemSnapshot[] = [];
  for (const mutation of plan.mutations) {
    if (mutation.kind === "create") {
      database.items.push({ ...mutation.item });
      affected.push({ ...mutation.item });
    } else if (mutation.kind === "revise") {
      const item = database.items.find((candidate) => candidate.id === mutation.itemId)!;
      item.title = mutation.title;
      item.revision += 1;
      affected.push({ ...item });
    } else {
      const deleted = database.items.find((candidate) => candidate.id === mutation.itemId)!;
      database.items = database.items.filter((candidate) => candidate.id !== mutation.itemId);
      delete database.parents[mutation.itemId];
      affected.push({ ...deleted });
    }
  }

  if (plan.prototypeFailureAfter === "state") {
    return { ok: false, error: { code: "dependencyUnavailable", dependency: "database" } };
  }

  database.events.push(...plan.events.map((event) => ({ ...event })));
  const receipt: PlanningCommitReceipt = {
    status: "committed",
    items: affected,
    events: plan.events.map((event) => ({ ...event })),
    replayed: false,
  };
  if (plan.idempotency) {
    database.replays[replayKey(plan.idempotency.principalId, plan.idempotency.key)] = {
      fingerprint: plan.fingerprint,
      receipt,
    };
  }
  return { ok: true, receipt };
}

abstract class PrototypeStore implements PlanningItemsStore {
  protected database: PrototypeDatabase;

  constructor(database = initialDatabase()) {
    this.database = structuredClone(database);
  }

  async prepare(request: PlanningPreparationRequest) {
    return prepare(this.database, request);
  }

  debugState() {
    return structuredClone(this.database);
  }

  protected atomically(plan: PlanningCommitPlan) {
    const candidate = structuredClone(this.database);
    const result = applyPlan(candidate, plan);
    if (result.ok) this.database = candidate;
    return result;
  }

  abstract commit(plan: PlanningCommitPlan): Promise<PlanningStoreResult>;
}

export class InMemoryPlanningItemsStore extends PrototypeStore {
  async commit(plan: PlanningCommitPlan) {
    return this.atomically(plan);
  }
}

export class SupabaseRpcPlanningItemsStorePrototype extends PrototypeStore {
  async commit(plan: PlanningCommitPlan) {
    // Simulates the JSON serialization and single-RPC transaction shape.
    const rpcPayload = JSON.parse(JSON.stringify(plan)) as PlanningCommitPlan;
    return this.atomically(rpcPayload);
  }
}

export function revisionPlan({
  title,
  key = "revision-1",
  fail = false,
}: {
  title: string;
  key?: string;
  fail?: boolean;
}): PlanningCommitPlan {
  return {
    commandKind: "reviseItem",
    fingerprint: JSON.stringify({ itemId: "deliverable-1", title }),
    preconditions: [{ kind: "revision", itemId: "deliverable-1", expected: 1 }],
    mutations: [{ kind: "revise", itemId: "deliverable-1", title }],
    events: [
      { kind: "activity", itemId: "deliverable-1", message: "Title revised" },
      { kind: "audit", itemId: "deliverable-1", action: "planning_item.revised" },
    ],
    idempotency: { principalId: "token-1", key },
    prototypeFailureAfter: fail ? "state" : undefined,
  };
}
