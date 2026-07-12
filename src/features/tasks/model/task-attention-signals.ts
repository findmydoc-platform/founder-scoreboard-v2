import { hasOpenWaitingRelation } from "@/lib/platform";
import { addDaysIso, currentIsoDate } from "@/lib/planning-schedule";
import { normalizeStatus } from "@/lib/status";
import type { PlanningData, Task } from "@/lib/types";

export type TaskAttentionSignal = {
  id: string;
  label: string;
  kind: "critical" | "quality" | "review";
};

type SignalData = Pick<PlanningData, "taskBlockers" | "taskRelations" | "tasks">;

function taskHasOpenBlocker(taskId: string, data: Pick<PlanningData, "taskBlockers">) {
  return data.taskBlockers.some((blocker) => blocker.taskId === taskId && blocker.status === "open");
}

function taskHasOwner(task: Task) {
  return Boolean(task.assignee?.trim() || task.assigneeId || task.owner?.trim() || task.ownerId);
}

function taskMissingEvidence(task: Task) {
  return Boolean(task.sprintId && normalizeStatus(task.status) !== "Erledigt" && !task.evidenceLink && !task.githubIssueUrl && !task.issueUrl);
}

function reviewIsOverdue(task: Task) {
  if (normalizeStatus(task.status) !== "Review" && task.reviewStatus !== "requested") return false;
  const reviewDate = (task.reviewRequestedAt || task.endDate || "").slice(0, 10);
  return Boolean(reviewDate && reviewDate < addDaysIso(currentIsoDate(), -2));
}

export function taskCriticalAttentionSignals(task: Task, data: SignalData): TaskAttentionSignal[] {
  const signals: TaskAttentionSignal[] = [];
  const status = normalizeStatus(task.status);

  if (task.priority === "P0" && !taskHasOwner(task) && task.taskType !== "proposal") {
    signals.push({ id: "owner-missing", label: "Owner fehlt", kind: "critical" });
  }
  if (status === "Blockiert" && !taskHasOpenBlocker(task.id, data)) {
    signals.push({ id: "blocker-missing", label: "Blocker fehlt", kind: "critical" });
  }
  if (hasOpenWaitingRelation(task.id, data.tasks, data.taskRelations)) {
    signals.push({ id: "waiting", label: "Wartet", kind: "critical" });
  }
  if (task.githubIssueSyncStatus === "failed") {
    signals.push({ id: "sync-failed", label: "Sync fehlgeschlagen", kind: "critical" });
  }

  return signals;
}

export function taskQualityAttentionSignals(task: Task): TaskAttentionSignal[] {
  const signals: TaskAttentionSignal[] = [];

  if (!task.acceptanceCriteria?.trim()) {
    signals.push({ id: "acceptance-criteria-missing", label: "AC fehlt", kind: "quality" });
  }
  if (!task.definitionOfDone?.trim()) {
    signals.push({ id: "definition-of-done-missing", label: "DoD fehlt", kind: "quality" });
  }
  if (taskMissingEvidence(task)) {
    signals.push({ id: "evidence-missing", label: "Evidence fehlt", kind: "quality" });
  }

  return signals;
}

export function taskReviewAttentionSignals(task: Task): TaskAttentionSignal[] {
  const signals: TaskAttentionSignal[] = [];

  if (reviewIsOverdue(task)) {
    signals.push({ id: "review-overdue", label: "Review >2d", kind: "review" });
  }
  if ((normalizeStatus(task.status) === "Review" || task.reviewStatus === "requested") && !task.reviewOwnerProfileId) {
    signals.push({ id: "review-owner-missing", label: "Ohne Review Owner", kind: "review" });
  }

  return signals;
}

export function taskPlanningAttentionSignals(task: Task, data: SignalData): TaskAttentionSignal[] {
  return [
    ...taskCriticalAttentionSignals(task, data),
    ...taskQualityAttentionSignals(task),
  ];
}

export function taskHasCriticalAttention(task: Task, data: SignalData) {
  return taskCriticalAttentionSignals(task, data).length > 0;
}

export function taskHasMissingEvidenceAttention(task: Task) {
  return taskMissingEvidence(task);
}
