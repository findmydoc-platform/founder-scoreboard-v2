import { subIssueEvidenceSummary } from "@/features/tasks/model/sub-issue-evidence";
import type { Task } from "@/lib/types";

export function selectSubIssueEvidenceTourTask(tasks: readonly Task[], selectedId: string | null) {
  const candidates = tasks.filter((task) => task.taskType === "deliverable" && !task.trashedAt);
  const selected = candidates.find((task) => task.id === selectedId);
  if (selected && subIssueEvidenceSummary(selected, tasks).count) return selected;
  return candidates.find((task) => subIssueEvidenceSummary(task, tasks).count) || selected || candidates[0];
}
