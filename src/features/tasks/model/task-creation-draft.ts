import type { Task, TaskType } from "@/lib/types";

type TaskCreationHierarchy = {
  taskType: TaskType;
  parentTaskId: string;
  packageId: string;
  milestoneId: string;
};

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
  const parent = taskCreationParent(tasks, parentTaskId);

  return {
    ...draft,
    parentTaskId,
    packageId: parent?.packageId || "",
    milestoneId: parent?.milestoneId || "",
  };
}

export function resolveTaskCreationHierarchy<T extends TaskCreationHierarchy>(draft: T, tasks: Task[]): T {
  if (draft.taskType !== "sub_issue") return draft;
  return withSubIssueParentHierarchy(draft, tasks, draft.parentTaskId);
}
