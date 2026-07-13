import type { PlanningData, TrashRootType } from "@/lib/types";

export type PlanningTrashStateSnapshot = Pick<
  PlanningData,
  | "packages"
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

function taskIdsForRoot(data: PlanningData, rootType: TrashRootType, rootId: string) {
  if (rootType === "initiative") {
    return new Set(data.tasks.filter((task) => task.packageId === rootId).map((task) => task.id));
  }
  return collectTaskTreeIds(data.tasks, rootId);
}

function restoreMissingById<T extends { id: string | number }>(current: T[], removed: T[]) {
  const currentIds = new Set(current.map((item) => item.id));
  return [...removed.filter((item) => !currentIds.has(item.id)), ...current];
}

export function removePlanningRootFromData(data: PlanningData, rootType: TrashRootType, rootId: string) {
  const taskIds = taskIdsForRoot(data, rootType, rootId);
  const snapshot: PlanningTrashStateSnapshot = {
    packages: rootType === "initiative" ? data.packages.filter((pack) => pack.id === rootId) : [],
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
      packages: rootType === "initiative" ? data.packages.filter((pack) => pack.id !== rootId) : data.packages,
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

export function restorePlanningRootToData(data: PlanningData, snapshot: PlanningTrashStateSnapshot): PlanningData {
  return {
    ...data,
    packages: restoreMissingById(data.packages, snapshot.packages),
    tasks: restoreMissingById(data.tasks, snapshot.tasks),
    taskActivity: restoreMissingById(data.taskActivity, snapshot.taskActivity),
    taskBlockers: restoreMissingById(data.taskBlockers, snapshot.taskBlockers),
    taskComments: restoreMissingById(data.taskComments, snapshot.taskComments),
    taskExternalComments: restoreMissingById(data.taskExternalComments, snapshot.taskExternalComments),
    taskFocusItems: restoreMissingById(data.taskFocusItems, snapshot.taskFocusItems),
    taskRelations: restoreMissingById(data.taskRelations, snapshot.taskRelations),
  };
}
