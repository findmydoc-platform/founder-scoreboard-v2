import type { Task, TaskStatus, TaskType } from "@/lib/types";

export const strategicPlanningStatuses: TaskStatus[] = ["Offen", "In Arbeit", "Pausiert", "Blockiert", "Erledigt"];

export function isStrategicPlanningItem(task: Pick<Task, "taskType"> | TaskType) {
  const taskType = typeof task === "string" ? task : task.taskType;
  return taskType === "epic" || taskType === "initiative";
}

export function canReviewPlanningItem(task: Pick<Task, "taskType"> | TaskType) {
  const taskType = typeof task === "string" ? task : task.taskType;
  return taskType === "deliverable";
}

export function canSyncPlanningItemToGitHub(task: Pick<Task, "taskType"> | TaskType) {
  const taskType = typeof task === "string" ? task : task.taskType;
  return taskType === "deliverable" || taskType === "sub_issue";
}

export function canHaveSprintPlanningItem(task: Pick<Task, "taskType"> | TaskType) {
  const taskType = typeof task === "string" ? task : task.taskType;
  return taskType === "deliverable";
}

export function allowedPlanningItemStatuses(task: Pick<Task, "taskType"> | TaskType): TaskStatus[] {
  const taskType = typeof task === "string" ? task : task.taskType;
  if (taskType === "epic" || taskType === "initiative") return strategicPlanningStatuses;
  if (taskType === "sub_issue") return ["Offen", "In Arbeit", "Blockiert", "Erledigt"];
  return ["Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt"];
}
