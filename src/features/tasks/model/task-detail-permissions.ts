import { isOperationalLeadRole } from "@/lib/platform";
import { isTaskReviewFinal, isTaskReviewLocked } from "@/features/reviews/model/task-review-state";
import { normalizeStatus, taskStatuses } from "@/lib/status";
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
  const reviewLocked = isTaskReviewLocked(task);
  const reviewFinal = isTaskReviewFinal(task);
  if (unrestricted) {
    return {
      canComment: true,
      canCreateSubIssue: !reviewLocked,
      canEditBrief: !reviewLocked,
      canEditChecklist: !reviewLocked,
      canEditEvidence: !reviewLocked,
      canEditNotes: !reviewLocked,
      canCompleteSubIssue: !reviewLocked && task.taskType === "sub_issue",
      canManageFinalStatus: !reviewLocked,
      canManageReviewOwner: !reviewFinal,
      canManageTaskMeta: !reviewLocked,
      canOpenReview: true,
      canReopenSubIssue: !reviewLocked && task.taskType === "sub_issue",
      canReportBlocker: !reviewLocked,
      canReparentSubIssue: !reviewLocked && task.taskType === "sub_issue",
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
    canCreateSubIssue: !reviewLocked && Boolean(role && role !== "viewer"),
    canEditBrief: !reviewLocked && canWorkOnTask,
    canEditChecklist: !reviewLocked && canWorkOnTask,
    canEditEvidence: !reviewLocked && canWorkOnTask,
    canEditNotes: !reviewLocked && canWorkOnTask,
    canCompleteSubIssue: !reviewLocked && canManageSubIssueFinalStatus,
    canManageFinalStatus: !reviewLocked && isCeo,
    canManageReviewOwner: isCeo && !reviewFinal,
    canManageTaskMeta: !reviewLocked && isOperationalLead,
    canOpenReview: isOperationalLead || Boolean(role && role !== "viewer" && profile?.id && task.reviewOwnerProfileId === profile.id),
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
): TaskStatus[] {
  const normalized = normalizeStatus(status);
  if (permissions.canManageFinalStatus) return taskStatuses;
  if (normalized === "Erledigt") {
    return permissions.canReopenSubIssue ? ["Erledigt", "Offen"] : ["Erledigt"];
  }

  const workingOptions = permissions.canUpdateWorkingStatus
    ? normalized === "Nacharbeit"
      ? (["In Arbeit", "Review", "Blockiert"] as TaskStatus[])
      : taskStatuses.filter((item) => item !== "Erledigt")
    : [normalized];

  return permissions.canCompleteSubIssue && !workingOptions.includes("Erledigt")
    ? [...workingOptions, "Erledigt"]
    : workingOptions;
}
