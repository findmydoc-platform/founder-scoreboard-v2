import type { ActorContext } from "./actor-context";
import type { PlanningItem } from "./planning-item-domain";
import type {
  AppliedEffect,
  FieldChange,
  PlanningCommand,
  PlanningError,
  PlanningInvocation,
} from "./planning-items";

export type PlanningPreparationRequest = Readonly<{
  actor: ActorContext;
  command: PlanningCommand;
  idempotencyKey?: string;
}>;

export type PlanningCommitReceipt = Readonly<{
  items: readonly PlanningItem[];
  changes: readonly FieldChange[];
  effects: readonly AppliedEffect[];
  replayed: boolean;
}>;

export type PlanningPreparation<State> =
  | Readonly<{ kind: "state"; state: State }>
  | Readonly<{ kind: "replay"; receipt: PlanningCommitReceipt }>
  | Readonly<{ kind: "error"; error: PlanningError }>;

export type PlanningCommitRequest<CommitPlan> = Readonly<{
  actor: ActorContext;
  command: PlanningCommand;
  plan: CommitPlan;
  idempotencyKey?: string;
  requestMetadata?: PlanningInvocation["requestMetadata"];
}>;

export type PlanningCommitOutcome =
  | Readonly<{ ok: true; receipt: PlanningCommitReceipt }>
  | Readonly<{ ok: false; error: PlanningError }>;

export interface PlanningItemsStore<State, CommitPlan> {
  prepare(request: PlanningPreparationRequest): Promise<PlanningPreparation<State>>;
  commit(request: PlanningCommitRequest<CommitPlan>): Promise<PlanningCommitOutcome>;
}

export const PLANNING_STORE_UNAVAILABLE: PlanningError = Object.freeze({
  code: "dependencyUnavailable",
  dependency: "database",
  retryable: true,
});
