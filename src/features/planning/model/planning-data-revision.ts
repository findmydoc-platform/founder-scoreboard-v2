import type { Task } from "@/lib/types";

export type PlanningTaskRevision = {
  activeTaskCount: number;
  latestUpdatedAt: string;
};

export function planningTaskRevision(tasks: readonly Task[]): PlanningTaskRevision {
  let latestUpdatedAt = "";
  for (const task of tasks) {
    if (task.updatedAt && task.updatedAt > latestUpdatedAt) latestUpdatedAt = task.updatedAt;
  }
  return {
    activeTaskCount: tasks.length,
    latestUpdatedAt,
  };
}

export function planningTaskRevisionsEqual(left: PlanningTaskRevision, right: PlanningTaskRevision) {
  return left.activeTaskCount === right.activeTaskCount && left.latestUpdatedAt === right.latestUpdatedAt;
}
