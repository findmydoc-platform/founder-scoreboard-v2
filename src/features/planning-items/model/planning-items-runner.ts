import type { ActorContext } from "./actor-context";
import type { PlanningItem } from "./planning-item-domain";
import type {
  FieldChange,
  PlannedEffect,
  PlanningCommand,
  PlanningError,
  PlanningItems,
  PlanningResult,
  PlanningWarning,
} from "./planning-items";
import type {
  PlanningCommitReceipt,
  PlanningItemsStore,
  PlanningPreparation,
} from "./planning-items-store";

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

export type PlanningItemsRunnerDependencies<State, CommitPlan> = Readonly<{
  store: PlanningItemsStore<State, CommitPlan>;
  decisionCore: PlanningDecisionCore<State, CommitPlan>;
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
        preparation = await dependencies.store.prepare({
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

      let outcome;
      try {
        outcome = await dependencies.store.commit({
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
