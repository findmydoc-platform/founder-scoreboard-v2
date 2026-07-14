import { isOperationalLeadRole } from "@/lib/platform";
import { normalizeStatus, taskStatuses } from "@/lib/status";
import type { AuthenticatedProfile, Profile, Task, TaskStatus } from "@/lib/types";

type TaskPermissionProfile = Pick<AuthenticatedProfile, "id" | "name" | "platformRole">;
type TaskPermissionTask = Pick<Task, "assignee" | "assigneeId" | "owner" | "ownerId" | "reviewOwnerProfileId" | "taskType">;

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
  if (unrestricted) {
    return {
      canComment: true,
      canCreateSubIssue: true,
      canEditBrief: true,
      canEditChecklist: true,
      canEditEvidence: true,
      canEditNotes: true,
      canCompleteSubIssue: task.taskType === "sub_issue",
      canManageFinalStatus: true,
      canManageReviewOwner: true,
      canManageTaskMeta: true,
      canOpenReview: true,
      canReopenSubIssue: task.taskType === "sub_issue",
      canReportBlocker: true,
      canReparentSubIssue: task.taskType === "sub_issue",
      canUpdateStatus: true,
      canUpdateWorkingStatus: true,
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
    canCreateSubIssue: Boolean(role && role !== "viewer"),
    canEditBrief: canWorkOnTask,
    canEditChecklist: canWorkOnTask,
    canEditEvidence: canWorkOnTask,
    canEditNotes: canWorkOnTask,
    canCompleteSubIssue: canManageSubIssueFinalStatus,
    canManageFinalStatus: isCeo,
    canManageReviewOwner: isCeo,
    canManageTaskMeta: isOperationalLead,
    canOpenReview: isOperationalLead || Boolean(profile?.id && task.reviewOwnerProfileId === profile.id),
    canReopenSubIssue: canManageSubIssueFinalStatus,
    canReportBlocker: canWorkOnTask,
    canReparentSubIssue: task.taskType === "sub_issue" && canWorkOnTask,
    canUpdateStatus: canWorkOnTask || canManageSubIssueFinalStatus,
    canUpdateWorkingStatus: canWorkOnTask,
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
