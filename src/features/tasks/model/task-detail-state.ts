import { taskAssigneeLabel } from "@/lib/display";
import { effectiveTaskRelation, taskRelationsFor } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import type { Task, TaskRelation } from "@/lib/types";

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
  | "parentTaskId"
  | "sprintId"
  | "fixedDate"
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
  "priority" | "assignee" | "parentTaskId" | "sprintId" | "fixedDate"
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
    parentTaskId: task.parentTaskId,
    sprintId: task.sprintId,
    fixedDate: task.fixedDate,
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
    parentTaskId: meta.parentTaskId,
    sprintId: meta.sprintId,
    fixedDate: meta.fixedDate,
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
