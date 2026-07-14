import type { TaskDetailData } from "@/lib/task-detail-data";
import type { PlanningData } from "@/lib/types";

export function mergeTaskDetailData(current: PlanningData, taskId: string, detailData: TaskDetailData): PlanningData {
  return {
    ...current,
    taskComments: [
      ...detailData.taskComments,
      ...current.taskComments.filter((comment) => comment.taskId !== taskId),
    ],
    taskExternalComments: [
      ...detailData.taskExternalComments,
      ...current.taskExternalComments.filter((comment) => comment.taskId !== taskId),
    ],
    taskBlockers: [
      ...detailData.taskBlockers,
      ...current.taskBlockers.filter((blocker) => blocker.taskId !== taskId),
    ],
    taskActivity: [
      ...detailData.taskActivity,
      ...current.taskActivity.filter((activity) => activity.taskId !== taskId),
    ],
    taskRelations: [
      ...detailData.taskRelations,
      ...current.taskRelations.filter((relation) => relation.taskId !== taskId && relation.relatedTaskId !== taskId),
    ],
  };
}
