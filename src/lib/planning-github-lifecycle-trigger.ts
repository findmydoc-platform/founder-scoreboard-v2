import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TrashRootType } from "@/lib/types";

export type PlanningGitHubLifecycleTriggerInput = {
  rootType: TrashRootType;
  rootId: string;
  eventIds: Array<string | number>;
  supabase: SupabaseClient;
};

export type PlanningGitHubLifecycleDrain = (
  input: PlanningGitHubLifecycleTriggerInput,
) => Promise<void>;

let registeredDrain: PlanningGitHubLifecycleDrain | null = null;

// The lifecycle worker registers its concrete drain during server module initialization.
export function registerPlanningGitHubLifecycleDrain(drain: PlanningGitHubLifecycleDrain | null) {
  registeredDrain = drain;
}

export async function attemptPlanningGitHubLifecycleDrain(input: PlanningGitHubLifecycleTriggerInput) {
  if (!registeredDrain) return { attempted: false, completed: false } as const;

  try {
    await registeredDrain(input);
    return { attempted: true, completed: true } as const;
  } catch (error) {
    return {
      attempted: true,
      completed: false,
      error: error instanceof Error ? error.message : "GitHub lifecycle processing failed.",
    } as const;
  }
}
