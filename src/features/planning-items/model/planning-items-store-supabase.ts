import "server-only";
import {
  PLANNING_STORE_UNAVAILABLE,
  type PlanningCommitOutcome,
  type PlanningCommitRequest,
  type PlanningItemsStore,
  type PlanningPreparation,
  type PlanningPreparationRequest,
} from "./planning-items-store";

type ProviderResult<T> = Readonly<{
  data: T | null;
  error: unknown | null;
}>;

export type SupabasePlanningItemsOperations<State, CommitPlan> = Readonly<{
  // A command slice may perform selective reads here. It must return domain state only.
  prepareCommand(request: PlanningPreparationRequest): Promise<ProviderResult<PlanningPreparation<State>>>;
  // A command slice must implement this as one authoritative database transaction/RPC.
  commitCommand(request: PlanningCommitRequest<CommitPlan>): Promise<ProviderResult<PlanningCommitOutcome>>;
}>;

function unavailablePreparation<State>(): PlanningPreparation<State> {
  return { kind: "error", error: PLANNING_STORE_UNAVAILABLE };
}

function validPreparation<State>(value: unknown): value is PlanningPreparation<State> {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.kind === "state") return Object.hasOwn(record, "state");
  if (record.kind === "replay") return Boolean(record.receipt && typeof record.receipt === "object");
  if (record.kind === "error") return Boolean(record.error && typeof record.error === "object");
  return false;
}

function validOutcome(value: unknown): value is PlanningCommitOutcome {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  if (record.ok === true) return Boolean(record.receipt && typeof record.receipt === "object");
  if (record.ok === false) return Boolean(record.error && typeof record.error === "object");
  return false;
}

export function createSupabasePlanningItemsStore<State, CommitPlan>(
  operations: SupabasePlanningItemsOperations<State, CommitPlan>,
): PlanningItemsStore<State, CommitPlan> {
  return {
    async prepare(request) {
      try {
        const result = await operations.prepareCommand(request);
        return result.error || !validPreparation<State>(result.data)
          ? unavailablePreparation()
          : result.data;
      } catch {
        return unavailablePreparation();
      }
    },
    async commit(request) {
      try {
        const result = await operations.commitCommand(request);
        return result.error || !validOutcome(result.data)
          ? { ok: false, error: PLANNING_STORE_UNAVAILABLE }
          : result.data;
      } catch {
        return { ok: false, error: PLANNING_STORE_UNAVAILABLE };
      }
    },
  };
}
