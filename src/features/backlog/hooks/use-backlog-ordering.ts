"use client";

import { useTransition } from "react";
import { persistLocalPlanningTasks } from "@/features/planning/hooks/use-local-planning-state";
import * as taskApi from "@/features/tasks/model/task-api-client";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { PlanningData, Task } from "@/lib/types";

type UseBacklogOrderingOptions = {
  apiClient: BrowserApiClient;
  canManageBacklog: boolean;
  orderedTasks: Task[];
  refreshPlanningData: () => Promise<void>;
  setData: (updater: (current: PlanningData) => PlanningData) => void;
  setMessage: (message: string) => void;
  source: "seed" | "supabase";
};

export function useBacklogOrdering({
  apiClient,
  canManageBacklog,
  orderedTasks,
  refreshPlanningData,
  setData,
  setMessage,
  source,
}: UseBacklogOrderingOptions) {
  const [isReordering, startReorderTransition] = useTransition();

  const commitOrder = (nextTasks: Task[]) => {
    const updates = nextTasks.map((task, index) => ({
      id: task.id,
      sortOrder: (index + 1) * 10,
      expectedUpdatedAt: task.updatedAt || "",
    }));
    const previousTasks = orderedTasks;
    const nextTaskById = new Map(updates.map((update) => [update.id, update.sortOrder]));
    setMessage("");
    setData((current) => {
      const tasks = current.tasks.map((task) => nextTaskById.has(task.id) ? { ...task, order: nextTaskById.get(task.id)! } : task);
      if (source === "seed") {
        try {
          persistLocalPlanningTasks(tasks);
        } catch {
          // UI remains usable even if browser storage is unavailable.
        }
      }
      return { ...current, tasks };
    });

    if (source !== "supabase") return;

    startReorderTransition(async () => {
      const { response, body } = await taskApi.updateBacklogOrderRequest(apiClient, updates);
      if (response.ok) {
        const persistedById = new Map((body?.updates || []).map((update) => [update.id, update]));
        setData((current) => ({
          ...current,
          tasks: current.tasks.map((task) => {
            const persisted = persistedById.get(task.id);
            return persisted ? { ...task, order: persisted.sortOrder, updatedAt: persisted.updatedAt } : task;
          }),
        }));
        return;
      }
      const previousOrderById = new Map(previousTasks.map((task) => [task.id, task.order]));
      setData((current) => ({
        ...current,
        tasks: current.tasks.map((task) => previousOrderById.has(task.id) ? { ...task, order: previousOrderById.get(task.id)! } : task),
      }));
      await refreshPlanningData();
      setMessage(body?.error || "Backlog-Reihenfolge konnte nicht gespeichert werden.");
    });
  };

  const reorderTask = (taskId: string, beforeTaskId: string) => {
    if (!canManageBacklog) {
      setMessage("Nur CEO oder Deputy können die Backlog-Reihenfolge ändern.");
      return;
    }
    if (taskId === beforeTaskId) return;
    const withoutTask = orderedTasks.filter((task) => task.id !== taskId);
    const movedTask = orderedTasks.find((task) => task.id === taskId);
    if (!movedTask) return;
    const targetIndex = withoutTask.findIndex((task) => task.id === beforeTaskId);
    if (targetIndex < 0) return;
    const nextTasks = [
      ...withoutTask.slice(0, targetIndex),
      movedTask,
      ...withoutTask.slice(targetIndex),
    ];
    commitOrder(nextTasks);
  };

  const moveTask = (taskId: string, direction: -1 | 1) => {
    if (!canManageBacklog) {
      setMessage("Nur CEO oder Deputy können die Backlog-Reihenfolge ändern.");
      return;
    }
    const index = orderedTasks.findIndex((task) => task.id === taskId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= orderedTasks.length) return;
    const nextTasks = [...orderedTasks];
    const [task] = nextTasks.splice(index, 1);
    nextTasks.splice(nextIndex, 0, task);
    commitOrder(nextTasks);
  };

  return {
    isReordering,
    moveTask,
    reorderTask,
  };
}
