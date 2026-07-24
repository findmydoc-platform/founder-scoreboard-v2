import { taskAssigneeLabel } from "@/lib/display";
import { taskRelationshipAccess } from "@/features/tasks/model/task-relationship-permissions";
import { effectiveTaskRelation, hasGitHubIssue, taskRelationsFor } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import type { Milestone, Package, Profile, Sprint, Task, TaskBlocker, TaskRelation } from "@/lib/types";

export type TaskRelationshipRow = {
  relation: TaskRelation;
  linkedTaskId: string;
  task?: Task;
};

export type TaskRelationshipRows = {
  waitsOn: TaskRelationshipRow[];
  blocks: TaskRelationshipRow[];
  related: TaskRelationshipRow[];
};

export type EditableTaskState = Pick<
  Task,
  | "title"
  | "status"
  | "priority"
  | "assignee"
  | "packageId"
  | "sprintId"
  | "milestoneId"
  | "startDate"
  | "endDate"
  | "deadline"
  | "reviewStatus"
  | "reviewOwnerProfileId"
  | "reviewRequestedAt"
  | "scoreFinal"
  | "dependsOn"
  | "evidenceLink"
  | "evidenceLinks"
  | "note"
  | "problemStatement"
  | "intendedOutcome"
  | "scopeConstraints"
  | "acceptanceCriteria"
  | "evidenceRequired"
  | "definitionOfDone"
>;

export type TaskDetailGitHubState = Pick<
  Task,
  "githubRepo" | "githubIssueNumber" | "githubIssueUrl" | "githubIssueSyncStatus" | "githubIssueLastSyncedAt" | "githubIssueSyncError" | "githubIssueSyncPendingSince"
>;

export type TaskDetailDetailsDraft = Pick<
  EditableTaskState,
  "priority" | "assignee" | "packageId" | "sprintId" | "milestoneId" | "startDate" | "endDate" | "deadline"
  | "reviewOwnerProfileId"
>;

export type TaskBriefDraft = Pick<
  EditableTaskState,
  "title" | "problemStatement" | "intendedOutcome" | "scopeConstraints" | "acceptanceCriteria" | "evidenceRequired" | "definitionOfDone"
>;

export function buildEditableTaskState(task: Task): EditableTaskState {
  return {
    title: task.title,
    status: normalizeStatus(task.status),
    priority: task.priority,
    assignee: task.assignee,
    packageId: task.packageId,
    sprintId: task.sprintId,
    milestoneId: task.milestoneId || "",
    startDate: task.startDate,
    endDate: task.endDate,
    deadline: task.deadline,
    reviewStatus: task.reviewStatus,
    reviewOwnerProfileId: task.reviewOwnerProfileId || "",
    reviewRequestedAt: task.reviewRequestedAt || "",
    scoreFinal: task.scoreFinal,
    dependsOn: task.dependsOn,
    evidenceLink: task.evidenceLink || task.issueUrl,
    evidenceLinks: task.evidenceLinks?.length ? [...task.evidenceLinks] : task.evidenceLink ? [task.evidenceLink] : [],
    note: task.note || "",
    problemStatement: task.problemStatement || task.description,
    intendedOutcome: task.intendedOutcome || "",
    scopeConstraints: task.scopeConstraints || "",
    acceptanceCriteria: task.acceptanceCriteria || "",
    evidenceRequired: task.evidenceRequired || "",
    definitionOfDone: task.definitionOfDone || "",
  };
}

export function buildTaskBriefDraft(task: Task): TaskBriefDraft {
  return {
    title: task.title,
    problemStatement: task.problemStatement || task.description,
    intendedOutcome: task.intendedOutcome || "",
    scopeConstraints: task.scopeConstraints || "",
    acceptanceCriteria: task.acceptanceCriteria || "",
    evidenceRequired: task.evidenceRequired || "",
    definitionOfDone: task.definitionOfDone || "",
  };
}

export function buildTaskDetailsDraft(meta: EditableTaskState): TaskDetailDetailsDraft {
  return {
    priority: meta.priority,
    assignee: meta.assignee,
    packageId: meta.packageId,
    sprintId: meta.sprintId,
    milestoneId: meta.milestoneId,
    startDate: meta.startDate,
    endDate: meta.endDate,
    deadline: meta.deadline,
    reviewOwnerProfileId: meta.reviewOwnerProfileId || "",
  };
}

export function buildTaskDetailGitHubState(task: Task): TaskDetailGitHubState {
  return {
    githubRepo: task.githubRepo,
    githubIssueNumber: task.githubIssueNumber,
    githubIssueUrl: task.githubIssueUrl,
    githubIssueSyncStatus: task.githubIssueSyncStatus,
    githubIssueLastSyncedAt: task.githubIssueLastSyncedAt,
    githubIssueSyncError: task.githubIssueSyncError,
    githubIssueSyncPendingSince: task.githubIssueSyncPendingSince || "",
  };
}

export function buildTaskRelationshipRows(task: Task, tasks: Task[], relations: TaskRelation[]): TaskRelationshipRows {
  const taskById = new Map(tasks.map((item) => [item.id, item]));
  const relationGroups = taskRelationsFor(task.id, relations);
  const toRow = (relation: TaskRelation): TaskRelationshipRow | null => {
    const effective = effectiveTaskRelation(task.id, relation);
    if (!effective) return null;
    return {
      relation,
      linkedTaskId: effective.linkedTaskId,
      task: taskById.get(effective.linkedTaskId),
    };
  };
  const uniqueRows = (group: TaskRelation[]) => {
    const seen = new Set<string>();
    return group.flatMap((relation) => {
      const row = toRow(relation);
      if (!row || seen.has(row.linkedTaskId)) return [];
      seen.add(row.linkedTaskId);
      return [row];
    });
  };
  const waitsOn = uniqueRows(relationGroups.waitsOn);
  const blocks = uniqueRows(relationGroups.blocks);
  const directionalTaskIds = new Set([...waitsOn, ...blocks].map((row) => row.linkedTaskId));
  const related = uniqueRows(relationGroups.related).filter((row) => !directionalTaskIds.has(row.linkedTaskId));

  return {
    waitsOn,
    blocks,
    related,
  };
}

export function relationTargetOptionsForTask(task: Task, allTasks: Task[]) {
  return allTasks
    .filter((item) => item.id !== task.id && item.taskType !== "sub_issue")
    .map((item) => ({ value: item.id, label: `${item.title} · ${taskAssigneeLabel(item)}` }));
}

export function buildTaskDetailViewModel({
  task,
  meta,
  githubState,
  pack,
  packages,
  sprint,
  sprints,
  milestones,
  profiles,
  blockers,
  relations,
  allTasks,
  currentProfile,
  unrestrictedRelationshipAccess = false,
}: {
  task: Task;
  meta: EditableTaskState;
  githubState: TaskDetailGitHubState;
  pack?: Package;
  packages: Package[];
  sprint?: Sprint;
  sprints: Sprint[];
  milestones: Milestone[];
  profiles: Profile[];
  blockers: TaskBlocker[];
  relations: TaskRelation[];
  allTasks: Task[];
  currentProfile?: Pick<Profile, "id" | "name" | "platformRole"> | null;
  unrestrictedRelationshipAccess?: boolean;
}) {
  const assigneeProfile = profiles.find((profile) => profile.name === meta.assignee || profile.id === meta.assignee);
  const creatorProfile = profiles.find((profile) => profile.name === task.createdBy || profile.id === task.createdBy)
    || profiles.find((profile) => profile.platformRole === "ceo")
    || assigneeProfile;
  const currentSprint = sprints.find((item) => item.id === meta.sprintId) || sprint;
  const currentMilestone = milestones.find((item) => item.id === meta.milestoneId);
  const currentPackage = packages.find((item) => item.id === meta.packageId) || pack;
  const profileName = (profileId: string) => profiles.find((profile) => profile.id === profileId)?.name || profileId || "Unbekannt";
  const openBlockers = blockers.filter((blocker) => blocker.status === "open");
  const { waitsOn, blocks, related } = buildTaskRelationshipRows(task, allTasks, relations);
  const relationTargetOptions = relationTargetOptionsForTask(task, allTasks);
  const canManageTaskMeta = currentProfile?.platformRole === "ceo" || currentProfile?.platformRole === "deputy";
  const relationshipAccess = taskRelationshipAccess({
    task,
    initiative: currentPackage,
    profile: currentProfile,
    unrestricted: unrestrictedRelationshipAccess,
  });
  const canSyncExistingGitHubIssue = hasGitHubIssue({
    githubIssueNumber: githubState.githubIssueNumber,
    githubIssueUrl: githubState.githubIssueUrl,
    issueNumber: task.issueNumber,
    issueUrl: task.issueUrl,
  });

  return {
    assigneeProfile,
    creatorProfile,
    currentSprint,
    currentMilestone,
    currentPackage,
    profileName,
    openBlockers,
    waitsOn,
    blocks,
    related,
    relationTargetOptions,
    canManageTaskMeta,
    relationshipAccess,
    canSyncExistingGitHubIssue,
  };
}

export function buildDetailsPackagePatch(packageId: string, packages: Package[], currentMilestoneId?: string): Partial<TaskDetailDetailsDraft> {
  const nextPackage = packages.find((item) => item.id === packageId);
  return { packageId, milestoneId: nextPackage?.milestoneId || currentMilestoneId || "" };
}

export function buildDetailsMilestonePatch(milestoneId: string, packages: Package[], currentPackageId?: string): Partial<TaskDetailDetailsDraft> {
  const nextPackage = packages.find((item) => !milestoneId || !item.milestoneId || item.milestoneId === milestoneId);
  return { milestoneId, packageId: nextPackage?.id || currentPackageId || "" };
}
