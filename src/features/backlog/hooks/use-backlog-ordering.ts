"use client";

import { useRef, useTransition } from "react";
import * as taskApi from "@/features/tasks/model/task-api-client";
import type { BacklogMovePlacement } from "@/features/tasks/model/task-api-client";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { PlanningData, Task } from "@/lib/types";

export type BacklogPlacement = BacklogMovePlacement;
export type BacklogMoveAction = "up" | "down" | "top" | "bottom";
export type BacklogMoveResult = "queued" | "ignored" | "blocked";

export type BacklogMoveTarget = {
  targetTaskId: string;
  placement: BacklogPlacement;
};

type UseBacklogOrderingOptions = {
  apiClient: BrowserApiClient;
  canManageBacklog: boolean;
  orderedTasks: Task[];
  refreshPlanningData: () => Promise<void>;
  setData: (updater: (current: PlanningData) => PlanningData) => void;
  setMessage: (message: string) => void;
  source: "supabase";
};

function reorderedBacklogTasks(tasks: Task[], taskId: string, targetTaskId: string, placement: BacklogPlacement) {
  if (taskId === targetTaskId) return null;
  const movedTask = tasks.find((task) => task.id === taskId);
  if (!movedTask) return null;

  const withoutMovedTask = tasks.filter((task) => task.id !== taskId);
  const targetIndex = withoutMovedTask.findIndex((task) => task.id === targetTaskId);
  if (targetIndex < 0) return null;

  const insertionIndex = placement === "before" ? targetIndex : targetIndex + 1;
  const nextTasks = [
    ...withoutMovedTask.slice(0, insertionIndex),
    movedTask,
    ...withoutMovedTask.slice(insertionIndex),
  ];

  return nextTasks.every((task, index) => task.id === tasks[index]?.id) ? null : nextTasks;
}

function targetForAction(tasks: Task[], taskId: string, action: BacklogMoveAction): BacklogMoveTarget | null {
  const taskIndex = tasks.findIndex((task) => task.id === taskId);
  if (taskIndex < 0) return null;

  if (action === "up") {
    const target = tasks[taskIndex - 1];
    return target ? { targetTaskId: target.id, placement: "before" } : null;
  }
  if (action === "down") {
    const target = tasks[taskIndex + 1];
    return target ? { targetTaskId: target.id, placement: "after" } : null;
  }
  if (action === "top") {
    const target = tasks[0];
    return target && target.id !== taskId ? { targetTaskId: target.id, placement: "before" } : null;
  }

  const target = tasks[tasks.length - 1];
  return target && target.id !== taskId ? { targetTaskId: target.id, placement: "after" } : null;
}

export function useBacklogOrdering({
  apiClient,
  canManageBacklog,
  orderedTasks,
  refreshPlanningData,
  setData,
  setMessage,
}: UseBacklogOrderingOptions) {
  const [isReordering, startReorderTransition] = useTransition();
  const reorderInFlightRef = useRef(false);

  const reorderTask = (taskId: string, targetTaskId: string, placement: BacklogPlacement): BacklogMoveResult => {
    if (!canManageBacklog) {
      setMessage("Nur CEO oder Deputy können die Backlog-Reihenfolge ändern.");
      return "blocked";
    }
    if (reorderInFlightRef.current) {
      setMessage("Backlog-Reihenfolge wird bereits gespeichert.");
      return "blocked";
    }

    const nextTasks = reorderedBacklogTasks(orderedTasks, taskId, targetTaskId, placement);
    if (!nextTasks) return "ignored";

    const task = orderedTasks.find((item) => item.id === taskId);
    const targetTask = orderedTasks.find((item) => item.id === targetTaskId);
    if (!task || !targetTask) return "ignored";
    if (!task.updatedAt || !targetTask.updatedAt) {
      setMessage("Backlog-Reihenfolge konnte nicht geprüft werden. Bitte neu laden.");
      return "blocked";
    }

    const previousTasks = orderedTasks;
    const nextOrderById = new Map(nextTasks.map((item, index) => [item.id, (index + 1) * 10]));
    setMessage("");
    setData((current) => {
      const tasks = current.tasks.map((item) => nextOrderById.has(item.id) ? { ...item, order: nextOrderById.get(item.id)! } : item);
      return { ...current, tasks };
    });

    reorderInFlightRef.current = true;
    startReorderTransition(async () => {
      const rollback = () => {
        const previousOrderById = new Map(previousTasks.map((item) => [item.id, item.order]));
        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => previousOrderById.has(item.id) ? { ...item, order: previousOrderById.get(item.id)! } : item),
        }));
      };

      try {
        const { response, body } = await taskApi.moveBacklogTaskRequest(apiClient, {
          taskId,
          targetTaskId,
          placement,
          expectedTaskUpdatedAt: task.updatedAt!,
          expectedTargetUpdatedAt: targetTask.updatedAt!,
        });
        if (response.ok) {
          const persistedById = new Map((body?.updates || []).map((update) => [update.id, update]));
          setData((current) => ({
            ...current,
            tasks: current.tasks.map((item) => {
              const persisted = persistedById.get(item.id);
              return persisted ? { ...item, order: persisted.sortOrder, updatedAt: persisted.updatedAt } : item;
            }),
          }));
          setMessage("Rangfolge aktualisiert.");
          return;
        }

        rollback();
        await refreshPlanningData().catch(() => {});
        setMessage(body?.error || "Backlog-Reihenfolge konnte nicht gespeichert werden.");
      } catch {
        rollback();
        await refreshPlanningData().catch(() => {});
        setMessage("Backlog-Reihenfolge konnte nicht gespeichert werden.");
      } finally {
        reorderInFlightRef.current = false;
      }
    });

    return "queued";
  };

  const moveTask = (taskId: string, action: BacklogMoveAction): BacklogMoveResult => {
    if (!canManageBacklog) {
      setMessage("Nur CEO oder Deputy können die Backlog-Reihenfolge ändern.");
      return "blocked";
    }
    const target = targetForAction(orderedTasks, taskId, action);
    return target ? reorderTask(taskId, target.targetTaskId, target.placement) : "ignored";
  };

  return {
    isReordering,
    moveTask,
    reorderTask,
  };
}
