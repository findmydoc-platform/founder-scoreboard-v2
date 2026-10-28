"use client";

import { useMemo, useState } from "react";
import { useBacklogOrdering } from "@/features/backlog/hooks/use-backlog-ordering";
import { useBacklogBulkSprintAssignment } from "@/features/backlog/hooks/use-backlog-bulk-sprint-assignment";
import { useBacklogSprintAssignment } from "@/features/backlog/hooks/use-backlog-sprint-assignment";
import type { BacklogAction } from "@/features/backlog/model/backlog-read-model";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { Dispatch } from "react";
import type { Sprint, Task } from "@/lib/types";

type UseBacklogCommandsOptions = {
  planningState: import("@/features/planning/model/planning-state").PlanningState;
  apiClient: BrowserApiClient;
  canManageBacklog: boolean;
  dispatch: Dispatch<BacklogAction>;
  orderedTasks: Task[];
  refreshBacklogModel: () => Promise<void>;
  sprints?: Sprint[];
};

export function useBacklogCommands({
  planningState,
  apiClient,
  canManageBacklog,
  dispatch,
  orderedTasks,
  refreshBacklogModel,
  sprints,
}: UseBacklogCommandsOptions) {
  const [message, setMessage] = useState("");
  const sprintById = useMemo(() => new Map((sprints || []).map((sprint) => [sprint.id, sprint])), [sprints]);
  const ordering = useBacklogOrdering({
    apiClient,
    canManageBacklog,
    orderedTasks,
    dispatch,
    refreshBacklogModel,
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
