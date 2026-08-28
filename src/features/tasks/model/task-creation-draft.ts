import type { Task, TaskType } from "@/lib/types";

type TaskCreationHierarchy = {
  taskType: TaskType;
  parentTaskId: string;
};

type TaskCreationRequestDraft = TaskCreationHierarchy & {
  creationRequestId: string;
  title: string;
  description: string;
  assignee: string;
  githubRepo: string;
  relationType: string;
  relatedTaskId: string;
  relationNote: string;
  priority: string;
  status: string;
  targetDate: string;
  intendedOutcome: string;
  acceptanceCriteria: string;
  scopeConstraints: string;
  createGitHubIssue?: boolean;
};

export const SUB_ISSUE_CREATE_REQUEST_FIELDS = [
  "creationRequestId",
  "title",
  "description",
  "problemStatement",
  "intendedOutcome",
  "scopeConstraints",
  "acceptanceCriteria",
  "evidenceRequired",
  "definitionOfDone",
  "taskType",
  "parentTaskId",
  "ownerId",
  "githubRepo",
  "relationType",
  "relatedTaskId",
  "relationNote",
] as const;

export function unsupportedSubIssueCreateField(payload: Record<string, unknown>) {
  const allowedFields = new Set<string>(SUB_ISSUE_CREATE_REQUEST_FIELDS);
  return Object.keys(payload).find((field) => !allowedFields.has(field)) || "";
}

export function taskCreationTitleError(title: string, visible: boolean) {
  if (!visible) return "";

  const titleLength = title.trim().length;
  if (titleLength === 0) return "Bitte einen Titel eingeben.";
  if (titleLength < 3) return "Der Titel benötigt mindestens 3 Zeichen.";
  return "";
}

export function taskCreationParent(tasks: Task[], parentTaskId: string) {
  return tasks.find((task) => task.id === parentTaskId && task.taskType === "deliverable") || null;
}

export function withSubIssueParentHierarchy<T extends TaskCreationHierarchy>(
  draft: T,
  tasks: Task[],
  parentTaskId: string,
): T {
  return {
    ...draft,
    parentTaskId,
  };
}

export function resolveTaskCreationHierarchy<T extends TaskCreationHierarchy>(draft: T, tasks: Task[]): T {
  if (draft.taskType !== "sub_issue") return draft;
  return withSubIssueParentHierarchy(draft, tasks, draft.parentTaskId);
}

export function taskCreationRequestPayload<T extends TaskCreationRequestDraft>(draft: T) {
  const { assignee, createGitHubIssue, ...canonicalDraft } = draft;
  void createGitHubIssue;
  if (draft.taskType === "deliverable") return { ...canonicalDraft, ownerId: assignee };
  if (draft.taskType === "epic" || draft.taskType === "initiative") {
    return {
      creationRequestId: draft.creationRequestId,
      title: draft.title,
      description: draft.description,
      taskType: draft.taskType,
      parentTaskId: draft.parentTaskId,
      ownerId: assignee,
      priority: draft.priority,
      status: draft.status,
      targetDate: draft.targetDate,
      strategy: draft.taskType === "initiative" ? {
        goal: draft.intendedOutcome,
        successCriteria: draft.acceptanceCriteria,
        scopeConstraints: draft.scopeConstraints,
      } : undefined,
    };
  }
  return {
    creationRequestId: draft.creationRequestId,
    title: draft.title,
    description: draft.description,
    taskType: draft.taskType,
    parentTaskId: draft.parentTaskId,
    ownerId: assignee,
    githubRepo: draft.githubRepo,
    relationType: draft.relationType,
    relatedTaskId: draft.relatedTaskId,
    relationNote: draft.relationNote,
  };
}
