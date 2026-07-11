import type { PlanningData } from "@/lib/types";

export type TaskDeletionSnapshot = Pick<
  PlanningData,
  | "tasks"
  | "taskActivity"
  | "taskBlockers"
  | "taskComments"
  | "taskExternalComments"
  | "taskFocusItems"
  | "taskRelations"
>;

function collectTaskTreeIds(tasks: PlanningData["tasks"], rootTaskId: string) {
  const taskIds = new Set([rootTaskId]);
  let foundChild = true;

  while (foundChild) {
    foundChild = false;
    for (const task of tasks) {
      if (!task.parentTaskId || !taskIds.has(task.parentTaskId) || taskIds.has(task.id)) continue;
      taskIds.add(task.id);
      foundChild = true;
    }
  }

  return taskIds;
}

function restoreMissingById<T extends { id: string | number }>(current: T[], removed: T[]) {
  const currentIds = new Set(current.map((item) => item.id));
  return [...removed.filter((item) => !currentIds.has(item.id)), ...current];
}

export function removeTaskTreeFromPlanningData(data: PlanningData, rootTaskId: string) {
  const taskIds = collectTaskTreeIds(data.tasks, rootTaskId);
  const snapshot: TaskDeletionSnapshot = {
    tasks: data.tasks.filter((task) => taskIds.has(task.id)),
    taskActivity: data.taskActivity.filter((activity) => taskIds.has(activity.taskId)),
    taskBlockers: data.taskBlockers.filter((blocker) => taskIds.has(blocker.taskId)),
    taskComments: data.taskComments.filter((comment) => taskIds.has(comment.taskId)),
    taskExternalComments: data.taskExternalComments.filter((comment) => taskIds.has(comment.taskId)),
    taskFocusItems: data.taskFocusItems.filter((focusItem) => taskIds.has(focusItem.taskId)),
    taskRelations: data.taskRelations.filter(
      (relation) => taskIds.has(relation.taskId) || taskIds.has(relation.relatedTaskId),
    ),
  };

  return {
    data: {
      ...data,
      tasks: data.tasks.filter((task) => !taskIds.has(task.id)),
      taskActivity: data.taskActivity.filter((activity) => !taskIds.has(activity.taskId)),
      taskBlockers: data.taskBlockers.filter((blocker) => !taskIds.has(blocker.taskId)),
      taskComments: data.taskComments.filter((comment) => !taskIds.has(comment.taskId)),
      taskExternalComments: data.taskExternalComments.filter((comment) => !taskIds.has(comment.taskId)),
      taskFocusItems: data.taskFocusItems.filter((focusItem) => !taskIds.has(focusItem.taskId)),
      taskRelations: data.taskRelations.filter(
        (relation) => !taskIds.has(relation.taskId) && !taskIds.has(relation.relatedTaskId),
      ),
    },
    snapshot,
    taskIds,
  };
}

export function restoreTaskTreeToPlanningData(data: PlanningData, snapshot: TaskDeletionSnapshot): PlanningData {
  return {
    ...data,
    tasks: restoreMissingById(data.tasks, snapshot.tasks),
    taskActivity: restoreMissingById(data.taskActivity, snapshot.taskActivity),
    taskBlockers: restoreMissingById(data.taskBlockers, snapshot.taskBlockers),
    taskComments: restoreMissingById(data.taskComments, snapshot.taskComments),
    taskExternalComments: restoreMissingById(data.taskExternalComments, snapshot.taskExternalComments),
    taskFocusItems: restoreMissingById(data.taskFocusItems, snapshot.taskFocusItems),
    taskRelations: restoreMissingById(data.taskRelations, snapshot.taskRelations),
  };
}
