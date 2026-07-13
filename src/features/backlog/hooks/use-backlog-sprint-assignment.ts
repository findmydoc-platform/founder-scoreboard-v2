"use client";

import {
  backlogSprintAssignmentMessage,
  getBacklogSprintAssignmentEligibility,
  type BacklogSprintAssignmentEligibility,
} from "@/features/backlog/model/backlog-planning-state";
import type { TaskUpdateHandler } from "@/features/tasks/hooks/task-mutation-command-types";
import type { Sprint, Task } from "@/lib/types";

type UseBacklogSprintAssignmentOptions = {
  canManageBacklog: boolean;
  onUpdateTask: TaskUpdateHandler;
  setMessage: (message: string) => void;
  sprintById?: ReadonlyMap<string, Sprint>;
};

export function useBacklogSprintAssignment({
  canManageBacklog,
  onUpdateTask,
  setMessage,
  sprintById,
}: UseBacklogSprintAssignmentOptions) {
  const assignTaskToSprint = async (task: Task, sprint: Sprint | null): Promise<BacklogSprintAssignmentEligibility> => {
    const eligibility = getBacklogSprintAssignmentEligibility(task, sprint, {
      canManage: canManageBacklog,
      sourceSprintLocked: Boolean(task.sprintId && sprintById?.get(task.sprintId)?.scoreLocked),
    });
    if (!eligibility.ok || eligibility.action === "noop") {
      setMessage(backlogSprintAssignmentMessage(eligibility.reason));
      return eligibility;
    }

    setMessage("");
    const update = await onUpdateTask(task, { sprintId: sprint?.id || "" });
    if (update && !update.ok) setMessage(update.error);
    return eligibility;
  };

  return {
    assignTaskToSprint,
    unassignTaskFromSprint: (task: Task) => assignTaskToSprint(task, null),
  };
}
