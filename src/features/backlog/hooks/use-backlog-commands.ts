"use client";

import { useMemo, useState } from "react";
import { useBacklogOrdering } from "@/features/backlog/hooks/use-backlog-ordering";
import { useBacklogBulkSprintAssignment } from "@/features/backlog/hooks/use-backlog-bulk-sprint-assignment";
import { useBacklogSprintAssignment } from "@/features/backlog/hooks/use-backlog-sprint-assignment";
import type { Sprint, Task } from "@/lib/types";

type UseBacklogCommandsOptions = {
  planningState: import("@/features/planning/model/planning-state").PlanningState;
  canManageBacklog: boolean;
  orderedTasks: Task[];
  sprints?: Sprint[];
};

export function useBacklogCommands({
  planningState,
  canManageBacklog,
  orderedTasks,
  sprints,
}: UseBacklogCommandsOptions) {
  const [message, setMessage] = useState("");
  const sprintById = useMemo(() => new Map((sprints || []).map((sprint) => [sprint.id, sprint])), [sprints]);
  const ordering = useBacklogOrdering({
    planningState,
    canManageBacklog,
    orderedTasks,
    setMessage,
  });
  const sprintAssignment = useBacklogSprintAssignment({
    planningState,
    canManageBacklog,
    setMessage,
    sprintById,
  });
  const bulkSprintAssignment = useBacklogBulkSprintAssignment({
    planningState,
    sprints,
    canManageBacklog,
    setMessage,
  });

  return {
    assignTasksToSprint: bulkSprintAssignment.assignTasksToSprint,
    assignTaskToSprint: sprintAssignment.assignTaskToSprint,
    isBulkAssigningSprint: bulkSprintAssignment.isBulkAssigningSprint,
    isReordering: ordering.isReordering,
    message,
    moveTask: ordering.moveTask,
    reorderTask: ordering.reorderTask,
    setMessage,
    unassignTaskFromSprint: sprintAssignment.unassignTaskFromSprint,
  };
}
