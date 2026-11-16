import { subIssueEvidenceSummary } from "@/features/tasks/model/sub-issue-evidence";
import type { Task } from "@/lib/types";

export function selectSubIssueEvidenceTourTask(tasks: readonly Task[], selectedId: string | null) {
  const candidates = tasks.filter((task) => task.taskType === "deliverable" && !task.trashedAt);
  const selected = candidates.find((task) => task.id === selectedId);
  const hasCurrentEvidence = (task: Task) => {
    const summary = subIssueEvidenceSummary(task, tasks);
    return summary.count === null ? summary.knownCount > 0 : summary.count > 0;
  };
  if (selected && hasCurrentEvidence(selected)) return selected;
  return candidates.find(hasCurrentEvidence) || selected || candidates[0];
}
