import type { PlanningShellState, TrashRootType } from "@/lib/types";

export type PlanningTrashStateSnapshot = Pick<
  PlanningShellState,
  | "tasks"
  | "taskActivity"
  | "taskBlockers"
  | "taskComments"
  | "taskExternalComments"
  | "taskFocusItems"
  | "taskRelations"
>;

function collectTaskTreeIds(tasks: PlanningShellState["tasks"], rootTaskId: string) {
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

function taskIdsForRoot(data: PlanningShellState, rootType: TrashRootType, rootId: string) {
  void rootType;
  return collectTaskTreeIds(data.tasks, rootId);
}

function restoreMissingById<T extends { id: string | number }>(current: T[], removed: T[]) {
  const currentIds = new Set(current.map((item) => item.id));
  return [...removed.filter((item) => !currentIds.has(item.id)), ...current];
}

export function removePlanningRootFromData(data: PlanningShellState, rootType: TrashRootType, rootId: string) {
  const taskIds = taskIdsForRoot(data, rootType, rootId);
  const snapshot: PlanningTrashStateSnapshot = {
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

export function restorePlanningRootToData(data: PlanningShellState, snapshot: PlanningTrashStateSnapshot): PlanningShellState {
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
