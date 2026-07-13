import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { drainPlanningGitHubLifecycleJobs } from "@/lib/planning-github-lifecycle";
import type { TrashRootType } from "@/lib/types";

export type PlanningGitHubLifecycleTriggerInput = {
  rootType: TrashRootType;
  rootId: string;
  taskIds: string[];
  supabase: SupabaseClient;
};

const OUTSTANDING_LIFECYCLE_STATUSES = ["pending", "retry_scheduled", "processing", "failed"];

export async function loadOutstandingPlanningGitHubLifecycleTaskIds(
  supabase: SupabaseClient,
  rootType: TrashRootType,
  rootId: string,
) {
  const { data, error } = await supabase
    .from("planning_github_lifecycle_outbox")
    .select("task_id")
    .eq("root_type", rootType)
    .eq("root_id", rootId)
    .in("status", OUTSTANDING_LIFECYCLE_STATUSES);
  return {
    taskIds: error
      ? []
      : [...new Set((data || []).map((row: { task_id?: string | null }) => row.task_id?.trim() || "").filter(Boolean))],
    error: error?.message || "",
  };
}

export async function attemptPlanningGitHubLifecycleDrain(input: PlanningGitHubLifecycleTriggerInput) {
  try {
    const taskIds = [...new Set(input.taskIds.map((taskId) => taskId.trim()).filter(Boolean))];
    const summary = await drainPlanningGitHubLifecycleJobs({
      supabase: input.supabase,
      limit: Math.min(taskIds.length || 1, 100),
      scope: {
        rootType: input.rootType,
        rootId: input.rootId,
        taskIds,
      },
    });
    const { data: outstandingJobs, error: outstandingError } = taskIds.length
      ? await input.supabase
          .from("planning_github_lifecycle_outbox")
          .select("id")
          .eq("root_type", input.rootType)
          .eq("root_id", input.rootId)
          .in("task_id", taskIds)
          .in("status", OUTSTANDING_LIFECYCLE_STATUSES)
          .limit(1)
      : { data: [], error: null };
    if (outstandingError) throw new Error(outstandingError.message);
    return {
      attempted: taskIds.length > 0,
      completed: summary.retryScheduled === 0
        && summary.failed === 0
        && (outstandingJobs || []).length === 0,
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
