"use client";

import { useMemo, useState } from "react";
import { useBacklogOrdering } from "@/features/backlog/hooks/use-backlog-ordering";
import { useBacklogSprintAssignment } from "@/features/backlog/hooks/use-backlog-sprint-assignment";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { PlanningData, Sprint, Task } from "@/lib/types";

type UseBacklogCommandsOptions = {
  apiClient: BrowserApiClient;
  canManageBacklog: boolean;
  onUpdateTask: (task: Task, patch: Partial<Task>) => void;
  orderedTasks: Task[];
  refreshPlanningData: () => Promise<void>;
  setData: (updater: (current: PlanningData) => PlanningData) => void;
  source: "seed" | "supabase";
  sprints?: Sprint[];
};

export function useBacklogCommands({
  apiClient,
  canManageBacklog,
  onUpdateTask,
  orderedTasks,
  refreshPlanningData,
  setData,
  source,
  sprints,
}: UseBacklogCommandsOptions) {
  const [message, setMessage] = useState("");
  const sprintById = useMemo(() => new Map((sprints || []).map((sprint) => [sprint.id, sprint])), [sprints]);
  const ordering = useBacklogOrdering({
    apiClient,
    canManageBacklog,
    orderedTasks,
    refreshPlanningData,
    setData,
    setMessage,
    source,
  });
  const sprintAssignment = useBacklogSprintAssignment({
    canManageBacklog,
    onUpdateTask,
    setMessage,
    sprintById,
  });

  return {
    assignTaskToSprint: sprintAssignment.assignTaskToSprint,
    isReordering: ordering.isReordering,
    message,
    moveTask: ordering.moveTask,
    reorderTask: ordering.reorderTask,
    setMessage,
    unassignTaskFromSprint: sprintAssignment.unassignTaskFromSprint,
  };
}
