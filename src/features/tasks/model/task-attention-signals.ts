import { hasOpenWaitingRelation } from "@/lib/platform";
import { addDaysIso, currentIsoDate } from "@/lib/planning-schedule";
import { normalizeStatus } from "@/lib/status";
import type { PlanningShellState, Task } from "@/lib/types";

export type TaskAttentionSignal = {
  id: string;
  label: string;
  kind: "critical" | "quality" | "review";
};

const planningSignals = {
  "owner-missing": { id: "owner-missing", label: "Owner fehlt", kind: "critical" },
  "blocker-missing": { id: "blocker-missing", label: "Blocker fehlt", kind: "critical" },
  waiting: { id: "waiting", label: "Wartet", kind: "critical" },
  "sync-failed": { id: "sync-failed", label: "Sync fehlgeschlagen", kind: "critical" },
  "acceptance-criteria-missing": { id: "acceptance-criteria-missing", label: "AC fehlt", kind: "quality" },
  "definition-of-done-missing": { id: "definition-of-done-missing", label: "DoD fehlt", kind: "quality" },
  "evidence-missing": { id: "evidence-missing", label: "Evidence fehlt", kind: "quality" },
} satisfies Record<string, TaskAttentionSignal>;

function planningSignal(id: keyof typeof planningSignals): TaskAttentionSignal {
  return { ...planningSignals[id] };
}

export function planningAttentionSignalsFromIds(ids: readonly string[]): TaskAttentionSignal[] | null {
  if (ids.some(id => !Object.hasOwn(planningSignals, id))) return null;
  return ids.map(id => planningSignal(id as keyof typeof planningSignals));
}

type SignalData = Pick<PlanningShellState, "taskBlockers" | "taskRelations" | "tasks">;

function taskHasOpenBlocker(taskId: string, data: Pick<PlanningShellState, "taskBlockers">) {
  return data.taskBlockers.some((blocker) => blocker.taskId === taskId && blocker.status === "open");
}

function taskHasOwner(task: Task) {
  return Boolean(task.assignee?.trim() || task.assigneeId || task.owner?.trim() || task.ownerId);
}

function taskMissingEvidence(task: Task) {
  return Boolean(
    task.taskType === "deliverable"
    && task.sprintId
    && normalizeStatus(task.status) !== "Erledigt"
    && !task.evidenceLink
    && !task.githubIssueUrl
    && !task.issueUrl,
  );
}

function reviewIsOverdue(task: Task) {
  if (task.taskType === "sub_issue") return false;
  if (normalizeStatus(task.status) !== "Review" && task.reviewStatus !== "requested") return false;
  const reviewDate = (task.reviewRequestedAt || "").slice(0, 10);
  return Boolean(reviewDate && reviewDate < addDaysIso(currentIsoDate(), -2));
}

export function taskCriticalAttentionSignals(task: Task, data: SignalData): TaskAttentionSignal[] {
  const signals: TaskAttentionSignal[] = [];
  const status = normalizeStatus(task.status);

  if (task.taskType === "deliverable" && task.priority === "P0" && !taskHasOwner(task)) {
    signals.push(planningSignal("owner-missing"));
  }
  if (status === "Blockiert" && !taskHasOpenBlocker(task.id, data)) {
    signals.push(planningSignal("blocker-missing"));
  }
  if (hasOpenWaitingRelation(task.id, data.tasks, data.taskRelations)) {
    signals.push(planningSignal("waiting"));
  }
  if ((task.taskType === "deliverable" || task.taskType === "sub_issue") && task.githubIssueSyncStatus === "failed") {
    signals.push(planningSignal("sync-failed"));
  }

  return signals;
}

export function taskQualityAttentionSignals(task: Task): TaskAttentionSignal[] {
  if (task.taskType !== "deliverable") return [];
  const signals: TaskAttentionSignal[] = [];

  if (!task.acceptanceCriteria?.trim()) {
    signals.push(planningSignal("acceptance-criteria-missing"));
  }
  if (!task.definitionOfDone?.trim()) {
    signals.push(planningSignal("definition-of-done-missing"));
  }
  if (taskMissingEvidence(task)) {
    signals.push(planningSignal("evidence-missing"));
  }

  return signals;
}

export function taskReviewAttentionSignals(task: Task): TaskAttentionSignal[] {
  if (task.taskType !== "deliverable") return [];
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
