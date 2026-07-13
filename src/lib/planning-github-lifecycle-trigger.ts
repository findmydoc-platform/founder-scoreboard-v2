import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { drainPlanningGitHubLifecycleJobs } from "@/lib/planning-github-lifecycle";
import type { TrashRootType } from "@/lib/types";

export type PlanningGitHubLifecycleTriggerInput = {
  rootType: TrashRootType;
  rootId: string;
  eventIds: Array<string | number>;
  supabase: SupabaseClient;
};

export async function attemptPlanningGitHubLifecycleDrain(input: PlanningGitHubLifecycleTriggerInput) {
  try {
    const summary = await drainPlanningGitHubLifecycleJobs({ supabase: input.supabase, limit: 100 });
    return {
      attempted: true,
      completed: summary.retryScheduled === 0 && summary.failed === 0,
      summary,
    } as const;
  } catch (error) {
    return {
      attempted: true,
      completed: false,
      error: error instanceof Error ? error.message : "GitHub lifecycle processing failed.",
    } as const;
  }
}
