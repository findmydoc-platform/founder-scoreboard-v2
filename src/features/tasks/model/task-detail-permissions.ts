import { isOperationalLeadRole } from "@/lib/platform";
import { isTaskReviewFinal, isTaskReviewLocked } from "@/features/reviews/model/task-review-state";
import { strategicPlanningStatuses } from "@/features/tasks/model/planning-item-capabilities";
import { normalizeStatus, normalizeSubIssueStatus, SUB_ISSUE_STATUSES, taskStatuses } from "@/lib/status";
import type { AuthenticatedProfile, Profile, Task, TaskStatus } from "@/lib/types";

type TaskPermissionProfile = Pick<AuthenticatedProfile, "id" | "name" | "platformRole">;
type TaskPermissionTask = Pick<Task, "assignee" | "assigneeId" | "owner" | "ownerId" | "reviewOwnerProfileId" | "reviewStatus" | "scoreFinal" | "taskType">
  & Partial<Pick<Task, "status">>;

export type TaskDetailPermissions = {
  canComment: boolean;
  canCreateSubIssue: boolean;
  canEditBrief: boolean;
  canEditChecklist: boolean;
  canEditEvidence: boolean;
  canEditNotes: boolean;
  canCompleteSubIssue: boolean;
  canManageFinalStatus: boolean;
  canManageReviewOwner: boolean;
  canManageTaskMeta: boolean;
  canOpenReview: boolean;
  canReopenSubIssue: boolean;
  canReportBlocker: boolean;
  canReparentSubIssue: boolean;
  canUpdateStatus: boolean;
  canUpdateWorkingStatus: boolean;
};

export function canContributorManageSubIssueFinalStatus({
  task,
  profile,
  unrestricted = false,
}: {
  task: Pick<TaskPermissionTask, "taskType">;
  profile?: Pick<TaskPermissionProfile, "platformRole"> | null;
  unrestricted?: boolean;
}) {
  if (task.taskType !== "sub_issue") return false;
  if (unrestricted) return true;
  return profile?.platformRole === "ceo"
    || profile?.platformRole === "deputy"
    || profile?.platformRole === "founder";
}

export function taskOwnedByProfile(task: TaskPermissionTask, profile?: TaskPermissionProfile | null) {
  if (!profile) return false;
  const identities = new Set([profile.id, profile.name].filter(Boolean));
  return [task.assigneeId, task.assignee, task.ownerId, task.owner]
    .filter(Boolean)
    .some((value) => identities.has(String(value)));
}

export function taskDetailPermissions({
  task,
  profile,
  unrestricted = false,
}: {
  task: TaskPermissionTask;
  profile?: TaskPermissionProfile | Pick<Profile, "id" | "name" | "platformRole"> | null;
  unrestricted?: boolean;
}): TaskDetailPermissions {
  const isSubIssue = task.taskType === "sub_issue";
  const isDeliverable = task.taskType === "deliverable";
  const reviewLocked = isDeliverable && isTaskReviewLocked(task);
  const reviewFinal = isDeliverable && isTaskReviewFinal(task);
  const completed = task.status === "Erledigt";
  const contentLocked = reviewLocked || completed;
  if (unrestricted) {
    return {
      canComment: true,
      canCreateSubIssue: !contentLocked && isDeliverable,
      canEditBrief: !contentLocked,
      canEditChecklist: !contentLocked && isDeliverable,
      canEditEvidence: !contentLocked && isDeliverable,
      canEditNotes: !contentLocked && !isSubIssue,
      canCompleteSubIssue: !contentLocked && isSubIssue,
      canManageFinalStatus: (!reviewLocked || completed) && !isSubIssue,
      canManageReviewOwner: !contentLocked && !reviewFinal && isDeliverable,
      canManageTaskMeta: !contentLocked,
      canOpenReview: !contentLocked && isDeliverable,
      canReopenSubIssue: (!reviewLocked || completed) && isSubIssue,
      canReportBlocker: !contentLocked,
      canReparentSubIssue: !contentLocked && isSubIssue,
      canUpdateStatus: !reviewLocked || completed,
      canUpdateWorkingStatus: !contentLocked,
    };
  }

  const role = profile?.platformRole;
  const isCeo = role === "ceo";
  const isOperationalLead = isOperationalLeadRole(role);
  const isFounder = role === "founder";
  const ownsTask = isFounder && taskOwnedByProfile(task, profile);
  const canWorkOnTask = isOperationalLead || ownsTask;
  const canManageSubIssueFinalStatus = canContributorManageSubIssueFinalStatus({ task, profile });

  return {
    canComment: Boolean(role && role !== "viewer"),
    canCreateSubIssue: !contentLocked && isDeliverable && Boolean(role && role !== "viewer"),
    canEditBrief: !contentLocked && canWorkOnTask,
    canEditChecklist: !contentLocked && isDeliverable && canWorkOnTask,
    canEditEvidence: !contentLocked && isDeliverable && canWorkOnTask,
    canEditNotes: !contentLocked && !isSubIssue && canWorkOnTask,
    canCompleteSubIssue: !contentLocked && canManageSubIssueFinalStatus,
    canManageFinalStatus: (!reviewLocked || completed) && !isSubIssue && isCeo,
    canManageReviewOwner: !contentLocked && isDeliverable && isCeo && !reviewFinal,
    canManageTaskMeta: !contentLocked && isOperationalLead,
    canOpenReview: !contentLocked && isDeliverable && (isOperationalLead || Boolean(role && role !== "viewer" && profile?.id && task.reviewOwnerProfileId === profile.id)),
    canReopenSubIssue: (!reviewLocked || completed) && canManageSubIssueFinalStatus,
    canReportBlocker: !contentLocked && canWorkOnTask,
    canReparentSubIssue: !contentLocked && task.taskType === "sub_issue" && canWorkOnTask,
    canUpdateStatus: (!reviewLocked || completed) && (canWorkOnTask || canManageSubIssueFinalStatus),
    canUpdateWorkingStatus: !contentLocked && canWorkOnTask,
  };
}

export function taskStatusOptionsForPermissions(
  status: string,
  permissions: Pick<
    TaskDetailPermissions,
    "canCompleteSubIssue" | "canManageFinalStatus" | "canReopenSubIssue" | "canUpdateWorkingStatus"
  >,
  taskType: Task["taskType"] = "deliverable",
): TaskStatus[] {
  const isSubIssue = taskType === "sub_issue";
  const isStrategic = taskType === "epic" || taskType === "initiative";
  const normalized = isSubIssue ? normalizeSubIssueStatus(status) : normalizeStatus(status);
  const availableStatuses: TaskStatus[] = isSubIssue ? [...SUB_ISSUE_STATUSES] : isStrategic ? strategicPlanningStatuses : taskStatuses;
  if (normalized === "Erledigt") {
    return permissions.canManageFinalStatus || permissions.canReopenSubIssue ? ["Erledigt", "Offen"] : ["Erledigt"];
  }
  if (permissions.canManageFinalStatus) return availableStatuses;

  const workingOptions = permissions.canUpdateWorkingStatus
    ? isSubIssue
      ? availableStatuses.filter((item) => item !== "Erledigt")
      : !isStrategic && normalized === "Nacharbeit"
      ? (["In Arbeit", "Review", "Blockiert"] as TaskStatus[])
      : availableStatuses.filter((item) => item !== "Erledigt")
    : [normalized];

  return permissions.canCompleteSubIssue && !workingOptions.includes("Erledigt")
    ? [...workingOptions, "Erledigt"]
    : workingOptions;
}
