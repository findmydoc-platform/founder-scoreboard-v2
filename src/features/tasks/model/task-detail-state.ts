import { taskOwnerLabel } from "@/lib/display";
import { hasGitHubIssue, taskRelationsFor } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import type { DecisionTaskLink, Milestone, Package, PlanningData, Profile, Sprint, Task, TaskBlocker, TaskFocusItem, TaskRelation } from "@/lib/types";

export type TaskRelationshipRows = {
  waitsOn: Array<{ relation: TaskRelation; task?: Task }>;
  blocks: Array<{ relation: TaskRelation; task?: Task }>;
  related: Array<{ relation: TaskRelation; task?: Task }>;
};

export type EditableTaskState = Pick<
  Task,
  | "status"
  | "priority"
  | "owner"
  | "packageId"
  | "sprintId"
  | "milestoneId"
  | "startDate"
  | "endDate"
  | "deadline"
  | "reviewStatus"
  | "reviewOwnerProfileId"
  | "dependsOn"
  | "evidenceLink"
  | "problemStatement"
  | "intendedOutcome"
  | "scopeConstraints"
  | "acceptanceCriteria"
  | "evidenceRequired"
  | "definitionOfDone"
>;

export type TaskDetailGitHubState = Pick<
  Task,
  "githubRepo" | "githubIssueNumber" | "githubIssueUrl" | "githubSyncStatus" | "githubLastSyncedAt" | "githubSyncError"
>;

export type TaskDetailDetailsDraft = Pick<
  EditableTaskState,
  "priority" | "owner" | "packageId" | "sprintId" | "milestoneId" | "startDate" | "endDate" | "deadline"
  | "reviewOwnerProfileId"
>;

export type TaskBriefDraft = Pick<
  EditableTaskState,
  "problemStatement" | "intendedOutcome" | "scopeConstraints" | "acceptanceCriteria" | "evidenceRequired" | "definitionOfDone"
>;

export function buildEditableTaskState(task: Task): EditableTaskState {
  return {
    status: normalizeStatus(task.status),
    priority: task.priority,
    owner: task.owner,
    packageId: task.packageId,
    sprintId: task.sprintId,
    milestoneId: task.milestoneId || "",
    startDate: task.startDate,
    endDate: task.endDate,
    deadline: task.deadline,
    reviewStatus: task.reviewStatus,
    reviewOwnerProfileId: task.reviewOwnerProfileId || "",
    dependsOn: task.dependsOn,
    evidenceLink: task.evidenceLink || task.issueUrl,
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
    owner: meta.owner,
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
    githubSyncStatus: task.githubSyncStatus,
    githubLastSyncedAt: task.githubLastSyncedAt,
    githubSyncError: task.githubSyncError,
  };
}

export function buildTaskRelationshipRows(task: Task, tasks: Task[], relations: TaskRelation[]): TaskRelationshipRows {
  const taskById = new Map(tasks.map((item) => [item.id, item]));
  const relationGroups = taskRelationsFor(task.id, relations);
  const relatedTask = (relation: TaskRelation) => taskById.get(relation.taskId === task.id ? relation.relatedTaskId : relation.taskId);

  return {
    waitsOn: relationGroups.waitsOn.map((relation) => ({ relation, task: taskById.get(relation.relatedTaskId) })),
    blocks: relationGroups.blocks.map((relation) => ({ relation, task: relatedTask(relation) })),
    related: relationGroups.related.map((relation) => ({ relation, task: relatedTask(relation) })),
  };
}

export function linkedDecisionsForTask(taskId: string, decisions: PlanningData["decisions"], decisionTaskLinks: DecisionTaskLink[]) {
  return decisionTaskLinks
    .filter((link) => link.taskId === taskId)
    .map((link) => ({ link, decision: decisions.find((decision) => decision.id === link.decisionId) }))
    .filter((item) => item.decision);
}

export function linkedFocusItemsForTask(taskId: string, focusItems: TaskFocusItem[]) {
  return focusItems
    .filter((item) => item.taskId === taskId)
    .sort((left, right) => right.focusDate.localeCompare(left.focusDate) || left.position - right.position)
    .slice(0, 5);
}

export function relationTargetOptionsForTask(task: Task, allTasks: Task[]) {
  return allTasks
    .filter((item) => item.id !== task.id && item.taskType !== "sub_issue")
    .map((item) => ({ value: item.id, label: `${item.title} · ${taskOwnerLabel(item)}` }));
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
  decisions,
  decisionTaskLinks,
  focusItems,
  currentRole,
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
  decisions: PlanningData["decisions"];
  decisionTaskLinks: DecisionTaskLink[];
  focusItems: TaskFocusItem[];
  currentRole: Profile["platformRole"] | "";
}) {
  const ownerProfile = profiles.find((profile) => profile.name === meta.owner || profile.id === meta.owner);
  const creatorProfile = profiles.find((profile) => profile.name === task.createdBy || profile.id === task.createdBy)
    || profiles.find((profile) => profile.platformRole === "ceo")
    || ownerProfile;
  const currentSprint = sprints.find((item) => item.id === meta.sprintId) || sprint;
  const currentMilestone = milestones.find((item) => item.id === meta.milestoneId);
  const currentPackage = packages.find((item) => item.id === meta.packageId) || pack;
  const profileName = (profileId: string) => profiles.find((profile) => profile.id === profileId)?.name || profileId || "Unbekannt";
  const openBlockers = blockers.filter((blocker) => blocker.status === "open");
  const { waitsOn, blocks, related } = buildTaskRelationshipRows(task, allTasks, relations);
  const linkedDecisions = linkedDecisionsForTask(task.id, decisions, decisionTaskLinks);
  const linkedFocusItems = linkedFocusItemsForTask(task.id, focusItems);
  const relationTargetOptions = relationTargetOptionsForTask(task, allTasks);
  const canManageTaskMeta = currentRole === "ceo" || currentRole === "deputy";
  const canSyncExistingGitHubIssue = hasGitHubIssue({
    githubIssueNumber: githubState.githubIssueNumber,
    githubIssueUrl: githubState.githubIssueUrl,
    issueNumber: task.issueNumber,
    issueUrl: task.issueUrl,
  });

  return {
    ownerProfile,
    creatorProfile,
    currentSprint,
    currentMilestone,
    currentPackage,
    profileName,
    openBlockers,
    waitsOn,
    blocks,
    related,
    linkedDecisions,
    linkedFocusItems,
    relationTargetOptions,
    canManageTaskMeta,
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
