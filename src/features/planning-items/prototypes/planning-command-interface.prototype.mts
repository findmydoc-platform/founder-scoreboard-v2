/**
 * PROTOTYPE — throw away after Wayfinder #285 is settled.
 *
 * Question: Can one external `run` seam, three intent-oriented command
 * families, and one stable result/error union cover the current Browser and
 * Team Planning Item writes without leaking HTTP, legacy fields, or RPCs?
 *
 * This is representative in-memory logic, not production behavior.
 */

export type ItemKind = "epic" | "initiative" | "deliverable" | "sub_issue";
export type PlatformRole = "ceo" | "deputy" | "founder" | "viewer";

export type ActorContext = {
  profileId: string;
  platformRole: PlatformRole;
  credential:
    | { kind: "session" }
    | { kind: "planningToken"; tokenId: string; scopes: readonly string[] }
    | { kind: "localDevelopment" };
};

export type PlanningItem = {
  id: string;
  kind: ItemKind;
  title: string;
  ownerId: string;
  parentId: string | null;
  approval: "proposed" | "approved" | "rejected" | null;
  status: "open" | "active" | "done";
  revision: number;
  trashed: boolean;
};

export type PlanningCommand =
  | {
      kind: "createItems";
      items: readonly Omit<PlanningItem, "revision" | "trashed">[];
    }
  | {
      kind: "reviseItem";
      itemId: string;
      expectedRevision: number;
      changes: Partial<Pick<PlanningItem, "title" | "ownerId" | "status">>;
    }
  | {
      kind: "actOnItem";
      itemId: string;
      expectedRevision: number;
      action:
        | { type: "decideApproval"; decision: "approve" | "reject" }
        | { type: "withdraw" }
        | { type: "restore" }
        | { type: "reparent"; parentId: string | null }
        | { type: "deleteEmptyEpic" }
        | { type: "requestIssueProjection"; createIfMissing: boolean };
    };

export type PlanningInvocation = {
  actor: ActorContext;
  mode: "preview" | "commit";
  command: PlanningCommand;
  idempotencyKey?: string;
};

export type PlanningEffect =
  | { kind: "audit"; itemId: string; action: string }
  | { kind: "issueProjectionRequested"; itemId: string; createIfMissing: boolean };

export type PlanningError =
  | { code: "invalidCommand"; message: string }
  | { code: "forbidden"; message: string }
  | { code: "notFound"; message: string }
  | { code: "conflict"; reason: "revision" | "idempotency" | "state"; message: string }
  | { code: "dependencyUnavailable"; dependency: "database" | "github"; message: string };

export type PlanningResult =
  | {
      ok: true;
      status: "previewed";
      items: readonly PlanningItem[];
      effects: readonly PlanningEffect[];
      warnings: readonly string[];
    }
  | {
      ok: true;
      status: "committed";
      items: readonly PlanningItem[];
      effects: readonly PlanningEffect[];
      replayed: boolean;
    }
  | { ok: false; error: PlanningError };

export type PrototypeState = {
  items: PlanningItem[];
  committedKeys: string[];
};

function canManage(actor: ActorContext, item?: PlanningItem) {
  return actor.platformRole === "ceo"
    || actor.platformRole === "deputy"
    || (actor.platformRole === "founder" && item?.ownerId === actor.profileId);
}

function parentIsValid(items: readonly PlanningItem[], item: PlanningItem) {
  if (item.kind === "epic") return item.parentId === null;
  if (item.parentId === null) return item.kind !== "sub_issue";
  const parent = items.find((candidate) => candidate.id === item.parentId && !candidate.trashed);
  if (!parent) return false;
  if (item.kind === "initiative") return parent.kind === "epic";
  if (item.kind === "deliverable") return parent.kind === "initiative";
  return parent.kind === "deliverable" && parent.approval === "approved";
}

export function initialState(): PrototypeState {
  return {
    items: [
      { id: "epic-1", kind: "epic", title: "Launch", ownerId: "ceo", parentId: null, approval: null, status: "active", revision: 1, trashed: false },
      { id: "initiative-1", kind: "initiative", title: "Readiness", ownerId: "founder", parentId: "epic-1", approval: "proposed", status: "open", revision: 1, trashed: false },
      { id: "deliverable-1", kind: "deliverable", title: "Runbook", ownerId: "founder", parentId: "initiative-1", approval: "approved", status: "active", revision: 1, trashed: false },
    ],
    committedKeys: [],
  };
}

export function runPlanningCommand(
  current: PrototypeState,
  invocation: PlanningInvocation,
): { state: PrototypeState; result: PlanningResult } {
  const state = structuredClone(current);
  const { actor, command, mode, idempotencyKey } = invocation;

  if (mode === "commit" && actor.credential.kind === "planningToken" && !idempotencyKey) {
    return { state: current, result: { ok: false, error: { code: "invalidCommand", message: "Token commits require an idempotency key." } } };
  }
  if (mode === "commit" && idempotencyKey && state.committedKeys.includes(idempotencyKey)) {
    return { state: current, result: { ok: true, status: "committed", items: [], effects: [], replayed: true } };
  }

  const affected: PlanningItem[] = [];
  const effects: PlanningEffect[] = [];

  if (command.kind === "createItems") {
    if (!["ceo", "deputy", "founder"].includes(actor.platformRole)) {
      return { state: current, result: { ok: false, error: { code: "forbidden", message: "Actor cannot create Planning Items." } } };
    }
    for (const draft of command.items) {
      const item: PlanningItem = { ...draft, revision: 1, trashed: false };
      if (state.items.some((candidate) => candidate.id === item.id) || !parentIsValid(state.items, item)) {
        return { state: current, result: { ok: false, error: { code: "invalidCommand", message: `Invalid create intent for ${item.id}.` } } };
      }
      state.items.push(item);
      affected.push(item);
      effects.push({ kind: "audit", itemId: item.id, action: "created" });
    }
  } else {
    const item = state.items.find((candidate) => candidate.id === command.itemId);
    if (!item) return { state: current, result: { ok: false, error: { code: "notFound", message: "Planning Item was not found." } } };
    if (item.revision !== command.expectedRevision) {
      return { state: current, result: { ok: false, error: { code: "conflict", reason: "revision", message: "Planning Item changed concurrently." } } };
    }
    if (command.kind === "reviseItem") {
      if (!canManage(actor, item) || item.trashed) {
        return { state: current, result: { ok: false, error: { code: "forbidden", message: "Actor cannot revise this Planning Item." } } };
      }
      const revised = { ...item, ...command.changes };
      if (!parentIsValid(state.items, revised)) {
        return { state: current, result: { ok: false, error: { code: "conflict", reason: "state", message: "Requested parent violates the hierarchy." } } };
      }
      Object.assign(item, revised, { revision: item.revision + 1 });
      affected.push(item);
      effects.push({ kind: "audit", itemId: item.id, action: "revised" });
    } else {
      const action = command.action;
      if (action.type === "requestIssueProjection") {
        if (!canManage(actor, item) || !["deliverable", "sub_issue"].includes(item.kind)) {
          return { state: current, result: { ok: false, error: { code: "forbidden", message: "Issue projection is not available for this item." } } };
        }
        effects.push({ kind: "issueProjectionRequested", itemId: item.id, createIfMissing: action.createIfMissing });
      } else if (!canManage(actor, item)) {
        return { state: current, result: { ok: false, error: { code: "forbidden", message: "Actor cannot perform this action." } } };
      } else if (action.type === "decideApproval") {
        if (!["ceo", "deputy"].includes(actor.platformRole) || !["initiative", "deliverable"].includes(item.kind)) {
          return { state: current, result: { ok: false, error: { code: "forbidden", message: "Approval decision is not allowed." } } };
        }
        item.approval = action.decision === "approve" ? "approved" : "rejected";
        item.revision += 1;
        affected.push(item);
      } else if (action.type === "withdraw") {
        item.trashed = true;
        item.revision += 1;
        affected.push(item);
      } else if (action.type === "restore") {
        item.trashed = false;
        item.revision += 1;
        affected.push(item);
      } else if (action.type === "reparent") {
        const revised = { ...item, parentId: action.parentId };
        if (!parentIsValid(state.items, revised)) {
          return { state: current, result: { ok: false, error: { code: "conflict", reason: "state", message: "Requested parent violates the hierarchy." } } };
        }
        Object.assign(item, revised, { revision: item.revision + 1 });
        affected.push(item);
      } else {
        const hasChildren = state.items.some((candidate) => candidate.parentId === item.id && !candidate.trashed);
        if (item.kind !== "epic" || hasChildren) {
          return { state: current, result: { ok: false, error: { code: "conflict", reason: "state", message: "Only an empty Epic can be deleted." } } };
        }
        state.items = state.items.filter((candidate) => candidate.id !== item.id);
        affected.push(item);
      }
      effects.push({ kind: "audit", itemId: item.id, action: action.type });
    }
  }

  if (mode === "preview") {
    return { state: current, result: { ok: true, status: "previewed", items: affected, effects, warnings: [] } };
  }
  if (idempotencyKey) state.committedKeys.push(idempotencyKey);
  return { state, result: { ok: true, status: "committed", items: affected, effects, replayed: false } };
}
