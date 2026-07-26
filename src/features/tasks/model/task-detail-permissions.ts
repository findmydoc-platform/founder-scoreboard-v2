import { isOperationalLeadRole } from "@/lib/platform";
import { isTaskReviewFinal, isTaskReviewLocked } from "@/features/reviews/model/task-review-state";
import { normalizeStatus, normalizeSubIssueStatus, SUB_ISSUE_STATUSES, taskStatuses } from "@/lib/status";
import type { AuthenticatedProfile, Profile, Task, TaskStatus } from "@/lib/types";

type TaskPermissionProfile = Pick<AuthenticatedProfile, "id" | "name" | "platformRole">;
type TaskPermissionTask = Pick<Task, "assignee" | "assigneeId" | "owner" | "ownerId" | "reviewOwnerProfileId" | "reviewStatus" | "scoreFinal" | "taskType">;

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
  const reviewLocked = !isSubIssue && isTaskReviewLocked(task);
  const reviewFinal = !isSubIssue && isTaskReviewFinal(task);
  if (unrestricted) {
    return {
      canComment: true,
      canCreateSubIssue: !reviewLocked && !isSubIssue,
      canEditBrief: !reviewLocked,
      canEditChecklist: !reviewLocked && !isSubIssue,
      canEditEvidence: !reviewLocked && !isSubIssue,
      canEditNotes: !reviewLocked && !isSubIssue,
      canCompleteSubIssue: !reviewLocked && isSubIssue,
      canManageFinalStatus: !reviewLocked && !isSubIssue,
      canManageReviewOwner: !reviewFinal && !isSubIssue,
      canManageTaskMeta: !reviewLocked,
      canOpenReview: !isSubIssue,
      canReopenSubIssue: !reviewLocked && isSubIssue,
      canReportBlocker: !reviewLocked,
      canReparentSubIssue: !reviewLocked && isSubIssue,
      canUpdateStatus: !reviewLocked,
      canUpdateWorkingStatus: !reviewLocked,
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
    canCreateSubIssue: !reviewLocked && !isSubIssue && Boolean(role && role !== "viewer"),
    canEditBrief: !reviewLocked && canWorkOnTask,
    canEditChecklist: !reviewLocked && !isSubIssue && canWorkOnTask,
    canEditEvidence: !reviewLocked && !isSubIssue && canWorkOnTask,
    canEditNotes: !reviewLocked && !isSubIssue && canWorkOnTask,
    canCompleteSubIssue: !reviewLocked && canManageSubIssueFinalStatus,
    canManageFinalStatus: !reviewLocked && !isSubIssue && isCeo,
    canManageReviewOwner: !isSubIssue && isCeo && !reviewFinal,
    canManageTaskMeta: !reviewLocked && isOperationalLead,
    canOpenReview: !isSubIssue && (isOperationalLead || Boolean(role && role !== "viewer" && profile?.id && task.reviewOwnerProfileId === profile.id)),
    canReopenSubIssue: !reviewLocked && canManageSubIssueFinalStatus,
    canReportBlocker: !reviewLocked && canWorkOnTask,
    canReparentSubIssue: !reviewLocked && task.taskType === "sub_issue" && canWorkOnTask,
    canUpdateStatus: !reviewLocked && (canWorkOnTask || canManageSubIssueFinalStatus),
    canUpdateWorkingStatus: !reviewLocked && canWorkOnTask,
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
  const normalized = isSubIssue ? normalizeSubIssueStatus(status) : normalizeStatus(status);
  const availableStatuses: TaskStatus[] = isSubIssue ? [...SUB_ISSUE_STATUSES] : taskStatuses;
  if (permissions.canManageFinalStatus) return taskStatuses;
  if (normalized === "Erledigt") {
    return permissions.canReopenSubIssue ? ["Erledigt", "Offen"] : ["Erledigt"];
  }

  const workingOptions = permissions.canUpdateWorkingStatus
    ? isSubIssue
      ? availableStatuses.filter((item) => item !== "Erledigt")
      : normalized === "Nacharbeit"
      ? (["In Arbeit", "Review", "Blockiert"] as TaskStatus[])
      : taskStatuses.filter((item) => item !== "Erledigt")
    : [normalized];

  return permissions.canCompleteSubIssue && !workingOptions.includes("Erledigt")
    ? [...workingOptions, "Erledigt"]
    : workingOptions;
}
