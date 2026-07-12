import { isOperationalLeadRole } from "@/lib/platform";
import type { AuthenticatedProfile, Profile, Task } from "@/lib/types";

type TaskPermissionProfile = Pick<AuthenticatedProfile, "id" | "name" | "platformRole">;
type TaskPermissionTask = Pick<Task, "assignee" | "assigneeId" | "owner" | "ownerId" | "reviewOwnerProfileId">;

export type TaskDetailPermissions = {
  canComment: boolean;
  canCreateSubIssue: boolean;
  canDeleteTask: boolean;
  canEditBrief: boolean;
  canEditChecklist: boolean;
  canEditEvidence: boolean;
  canEditNotes: boolean;
  canManageFinalStatus: boolean;
  canManageReviewOwner: boolean;
  canManageTaskMeta: boolean;
  canOpenReview: boolean;
  canReportBlocker: boolean;
  canUpdateStatus: boolean;
};

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
      canDeleteTask: true,
      canEditBrief: true,
      canEditChecklist: true,
      canEditEvidence: true,
      canEditNotes: true,
      canManageFinalStatus: true,
      canManageReviewOwner: true,
      canManageTaskMeta: true,
      canOpenReview: true,
      canReportBlocker: true,
      canUpdateStatus: true,
    };
  }

  const role = profile?.platformRole;
  const isCeo = role === "ceo";
  const isOperationalLead = isOperationalLeadRole(role);
  const isFounder = role === "founder";
  const ownsTask = isFounder && taskOwnedByProfile(task, profile);
  const canWorkOnTask = isOperationalLead || ownsTask;

  return {
    canComment: Boolean(role && role !== "viewer"),
    canCreateSubIssue: Boolean(role && role !== "viewer"),
    canDeleteTask: isOperationalLead,
    canEditBrief: canWorkOnTask,
    canEditChecklist: canWorkOnTask,
    canEditEvidence: canWorkOnTask,
    canEditNotes: canWorkOnTask,
    canManageFinalStatus: isCeo,
    canManageReviewOwner: isCeo,
    canManageTaskMeta: isOperationalLead,
    canOpenReview: isOperationalLead || Boolean(profile?.id && task.reviewOwnerProfileId === profile.id),
    canReportBlocker: canWorkOnTask,
    canUpdateStatus: canWorkOnTask,
  };
}
