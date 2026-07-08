"use client";

import { useState } from "react";
import { useBacklogOrdering } from "@/features/backlog/hooks/use-backlog-ordering";
import { useBacklogSprintAssignment } from "@/features/backlog/hooks/use-backlog-sprint-assignment";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { PlanningData, Task } from "@/lib/types";

type UseBacklogCommandsOptions = {
  apiClient: BrowserApiClient;
  canManageBacklog: boolean;
  onUpdateTask: (task: Task, patch: Partial<Task>) => void;
  orderedTasks: Task[];
  setData: (updater: (current: PlanningData) => PlanningData) => void;
  source: "seed" | "supabase";
};

export function useBacklogCommands({
  apiClient,
  canManageBacklog,
  onUpdateTask,
  orderedTasks,
  setData,
  source,
}: UseBacklogCommandsOptions) {
  const [message, setMessage] = useState("");
  const ordering = useBacklogOrdering({
    apiClient,
    canManageBacklog,
    orderedTasks,
    setData,
    setMessage,
    source,
  });
  const sprintAssignment = useBacklogSprintAssignment({
    canManageBacklog,
    onUpdateTask,
    setMessage,
  });

  return {
    assignTaskToSprint: sprintAssignment.assignTaskToSprint,
    isReordering: ordering.isReordering,
    message,
    moveTask: ordering.moveTask,
    reorderTask: ordering.reorderTask,
    setMessage,
  };
}
