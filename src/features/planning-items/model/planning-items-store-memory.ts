import type { PlanningCommand, PlanningError } from "./planning-items";
import {
  PLANNING_STORE_UNAVAILABLE,
  type PlanningCommitOutcome,
  type PlanningCommitRequest,
  type PlanningCommitReceipt,
  type PlanningItemsStore,
  type PlanningPreparationRequest,
} from "./planning-items-store";

type StoredReceipt = Readonly<{
  fingerprint: string;
  receipt: PlanningCommitReceipt;
}>;

type MemoryEnvelope<DatabaseState> = {
  database: DatabaseState;
  receipts: Map<string, StoredReceipt>;
  sequence: number;
};

export type PlanningStoreTransactionSources = Readonly<{
  now(): string;
  nextId(prefix: string): string;
  nextRevision(): string;
}>;

type PreparedState<State> =
  | Readonly<{ kind: "state"; state: State }>
  | Readonly<{ kind: "error"; error: PlanningError }>;

export type InMemoryPlanningItemsStoreOptions<DatabaseState, State, CommitPlan> = Readonly<{
  initialState: DatabaseState;
  now: () => string;
  id: (input: Readonly<{ prefix: string; sequence: number }>) => string;
  revision: (input: Readonly<{ now: string; sequence: number }>) => string;
  prepareState(input: Readonly<{
    snapshot: Readonly<DatabaseState>;
    request: PlanningPreparationRequest;
  }>): PreparedState<State> | Promise<PreparedState<State>>;
  applyCommit(input: Readonly<{
    draft: DatabaseState;
    request: PlanningCommitRequest<CommitPlan>;
    sources: PlanningStoreTransactionSources;
  }>): PlanningCommitOutcome | Promise<PlanningCommitOutcome>;
}>;

export type InspectablePlanningItemsStore<DatabaseState, State, CommitPlan> =
  PlanningItemsStore<State, CommitPlan> & Readonly<{
    inspect(): Readonly<{
      state: DatabaseState;
      receiptCount: number;
      sequence: number;
    }>;
  }>;

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function planningCommandFingerprint(command: PlanningCommand) {
  return stableJson(command);
}

function principal(request: Pick<PlanningPreparationRequest, "actor">) {
  const credential = request.actor.credential;
  if (credential.kind === "planningToken") return `planningToken:${credential.tokenId}`;
  return `${credential.kind}:${request.actor.profileId}`;
}

function receiptKey(request: PlanningPreparationRequest | PlanningCommitRequest<unknown>) {
  return request.idempotencyKey ? `${principal(request)}:${request.idempotencyKey}` : "";
}

function conflict(): PlanningCommitOutcome {
  return { ok: false, error: { code: "conflict", reason: "idempotency" } };
}

export function createInMemoryPlanningItemsStore<DatabaseState, State, CommitPlan>(
  options: InMemoryPlanningItemsStoreOptions<DatabaseState, State, CommitPlan>,
): InspectablePlanningItemsStore<DatabaseState, State, CommitPlan> {
  let envelope: MemoryEnvelope<DatabaseState> = {
    database: structuredClone(options.initialState),
    receipts: new Map(),
    sequence: 0,
  };

  return {
    async prepare(request) {
      const key = receiptKey(request);
      const existing = key ? envelope.receipts.get(key) : undefined;
      if (existing) {
        if (existing.fingerprint !== planningCommandFingerprint(request.command)) {
          return { kind: "error", error: { code: "conflict", reason: "idempotency" } };
        }
        return { kind: "replay", receipt: structuredClone(existing.receipt) };
      }
      try {
        return await options.prepareState({
          snapshot: structuredClone(envelope.database),
          request,
        });
      } catch {
        return { kind: "error", error: PLANNING_STORE_UNAVAILABLE };
      }
    },

    async commit(request) {
      const key = receiptKey(request);
      const fingerprint = planningCommandFingerprint(request.command);
      const existing = key ? envelope.receipts.get(key) : undefined;
      if (existing) {
        return existing.fingerprint === fingerprint
          ? { ok: true, receipt: { ...structuredClone(existing.receipt), replayed: true } }
          : conflict();
      }

      const candidate: MemoryEnvelope<DatabaseState> = {
        database: structuredClone(envelope.database),
        receipts: new Map(envelope.receipts),
        sequence: envelope.sequence,
      };
      const nextSequence = () => {
        candidate.sequence += 1;
        return candidate.sequence;
      };
      const sources: PlanningStoreTransactionSources = {
        now: options.now,
        nextId: (prefix) => options.id({ prefix, sequence: nextSequence() }),
        nextRevision: () => options.revision({ now: options.now(), sequence: nextSequence() }),
      };

      let outcome: PlanningCommitOutcome;
      try {
        outcome = await options.applyCommit({ draft: candidate.database, request, sources });
      } catch {
        return { ok: false, error: PLANNING_STORE_UNAVAILABLE };
      }
      if (!outcome.ok) return outcome;

      const receipt = { ...structuredClone(outcome.receipt), replayed: false };
      if (key) candidate.receipts.set(key, { fingerprint, receipt });
      envelope = candidate;
      return { ok: true, receipt };
    },

    inspect() {
      return {
        state: structuredClone(envelope.database),
        receiptCount: envelope.receipts.size,
        sequence: envelope.sequence,
      };
    },
  };
}
