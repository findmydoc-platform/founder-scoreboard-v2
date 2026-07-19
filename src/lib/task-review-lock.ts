import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isReviewStateLocked, reviewStateLockMessage } from "@/features/reviews/model/task-review-state";

type TaskReviewLockRow = {
  id: string;
  parent_task_id: string | null;
  review_status: string | null;
  score_final: boolean | null;
};

export async function taskIdsHaveReviewLock(
  supabase: SupabaseClient,
  taskIds: string[],
): Promise<{ locked: boolean; error: string; message: string }> {
  const ids = [...new Set(taskIds.filter(Boolean))];
  if (!ids.length) return { locked: false, error: "", message: "" };

  const { data: tasks, error: taskError } = await supabase
    .from("tasks")
    .select("id,parent_task_id,review_status,score_final")
    .in("id", ids);
  if (taskError) return { locked: false, error: taskError.message, message: "" };

  const rows = (tasks || []) as TaskReviewLockRow[];
  const lockedTask = rows.find((task) => isReviewStateLocked(task.review_status, task.score_final));
  if (lockedTask) {
    return { locked: true, error: "", message: reviewStateLockMessage(lockedTask.review_status, lockedTask.score_final) };
  }

  const parentIds = [...new Set(rows.map((task) => task.parent_task_id || "").filter(Boolean))];
  if (!parentIds.length) return { locked: false, error: "", message: "" };

  const { data: parents, error: parentError } = await supabase
    .from("tasks")
    .select("id,parent_task_id,review_status,score_final")
    .in("id", parentIds);
  if (parentError) return { locked: false, error: parentError.message, message: "" };

  const lockedParent = ((parents || []) as TaskReviewLockRow[]).find((parent) => isReviewStateLocked(parent.review_status, parent.score_final));

  return {
    locked: Boolean(lockedParent),
    error: "",
    message: lockedParent ? reviewStateLockMessage(lockedParent.review_status, lockedParent.score_final) : "",
  };
}
