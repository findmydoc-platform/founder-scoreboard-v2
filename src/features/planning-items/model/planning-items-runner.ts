import type { ActorContext } from "./actor-context";
import type { PlanningItem } from "./planning-item-domain";
import type {
  AppliedEffect,
  FieldChange,
  PlannedEffect,
  PlanningCommand,
  PlanningError,
  PlanningInvocation,
  PlanningItems,
  PlanningResult,
  PlanningWarning,
} from "./planning-items";

export type PlanningDecisionInput<State> = Readonly<{
  actor: ActorContext;
  command: PlanningCommand;
  state: State;
}>;

export type AcceptedPlanningDecision<CommitPlan> = Readonly<{
  ok: true;
  items: readonly PlanningItem[];
  changes: readonly FieldChange[];
  effects: readonly PlannedEffect[];
  warnings: readonly PlanningWarning[];
  commitPlan: CommitPlan;
}>;

export type PlanningDecision<CommitPlan> =
  | AcceptedPlanningDecision<CommitPlan>
  | Readonly<{ ok: false; error: PlanningError }>;

export interface PlanningDecisionCore<State, CommitPlan> {
  decide(input: PlanningDecisionInput<State>): PlanningDecision<CommitPlan>;
}

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

export type PlanningItemsRunnerDependencies<State, CommitPlan> = Readonly<{
  prepare(request: PlanningPreparationRequest): Promise<PlanningPreparation<State>>;
  decisionCore: PlanningDecisionCore<State, CommitPlan>;
  commit(request: PlanningCommitRequest<CommitPlan>): Promise<PlanningCommitOutcome>;
}>;

const unavailable: PlanningResult = {
  ok: false,
  error: {
    code: "dependencyUnavailable",
    dependency: "database",
    retryable: true,
  },
};

function committed(receipt: PlanningCommitReceipt): PlanningResult {
  return {
    ok: true,
    status: "committed",
    items: receipt.items,
    changes: receipt.changes,
    effects: receipt.effects,
    replayed: receipt.replayed,
  };
}

function missingTokenIdempotencyKey(): PlanningResult {
  return {
    ok: false,
    error: {
      code: "invalidCommand",
      issues: [{ path: "idempotencyKey", reason: "Planning token commits require an idempotency key." }],
    },
  };
}

export function createPlanningItems<State, CommitPlan>(
  dependencies: PlanningItemsRunnerDependencies<State, CommitPlan>,
): PlanningItems {
  return {
    async run(invocation) {
      if (
        invocation.mode === "commit"
        && invocation.actor.credential.kind === "planningToken"
        && !invocation.idempotencyKey?.trim()
      ) {
        return missingTokenIdempotencyKey();
      }

      let preparation: PlanningPreparation<State>;
      try {
        preparation = await dependencies.prepare({
          actor: invocation.actor,
          command: invocation.command,
          ...(invocation.mode === "commit" && invocation.idempotencyKey
            ? { idempotencyKey: invocation.idempotencyKey }
            : {}),
        });
      } catch {
        return unavailable;
      }

      if (preparation.kind === "error") return { ok: false, error: preparation.error };
      if (preparation.kind === "replay") {
        return invocation.mode === "commit"
          ? committed({ ...preparation.receipt, replayed: true })
          : unavailable;
      }

      const decision = dependencies.decisionCore.decide({
        actor: invocation.actor,
        command: invocation.command,
        state: preparation.state,
      });
      if (!decision.ok) return { ok: false, error: decision.error };

      if (invocation.mode === "preview") {
        return {
          ok: true,
          status: "previewed",
          items: decision.items,
          changes: decision.changes,
          effects: decision.effects,
          warnings: decision.warnings,
        };
      }

      let outcome: PlanningCommitOutcome;
      try {
        outcome = await dependencies.commit({
          actor: invocation.actor,
          command: invocation.command,
          plan: decision.commitPlan,
          ...(invocation.idempotencyKey ? { idempotencyKey: invocation.idempotencyKey } : {}),
          ...(invocation.requestMetadata ? { requestMetadata: invocation.requestMetadata } : {}),
        });
      } catch {
        return unavailable;
      }
      return outcome.ok ? committed(outcome.receipt) : { ok: false, error: outcome.error };
    },
  };
}
