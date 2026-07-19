"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { packageById, sortTasks } from "@/features/planning/model/planning-app-model";
import {
  backTaskPanelHistory,
  closeTaskPanelHistory,
  currentTaskPanelId,
  normalizeTaskPanelHistory,
  pushTaskPanelHistory,
  startTaskPanelHistory,
  type TaskPanelOpenMode,
} from "@/features/tasks/model/task-panel-selection";
import type { PlanningData } from "@/lib/types";

type UsePlanningTaskSelectionOptions = {
  data: PlanningData;
  selectedTaskId: string | null;
  setSelectedTaskId: (taskId: string | null) => void;
};

export function usePlanningTaskSelection({
  data,
  selectedTaskId,
  setSelectedTaskId,
}: UsePlanningTaskSelectionOptions) {
  const [taskPanelHistory, setTaskPanelHistory] = useState<string[]>([]);
  const availableTaskIds = useMemo(() => new Set(data.tasks.map((task) => task.id)), [data.tasks]);
  const selectedTask = data.tasks.find((task) => task.id === selectedTaskId) || null;
  const selectedPackage = selectedTask ? packageById(data.packages, selectedTask.packageId) : undefined;
  const selectedTaskSubIssues = selectedTask ? sortTasks(data.tasks.filter((task) => task.parentTaskId === selectedTask.id)) : [];
  const selectedTaskComments = selectedTask ? data.taskComments.filter((comment) => comment.taskId === selectedTask.id) : [];
  const selectedTaskExternalComments = selectedTask ? data.taskExternalComments.filter((comment) => comment.taskId === selectedTask.id) : [];
  const selectedTaskActivity = selectedTask ? data.taskActivity.filter((activity) => activity.taskId === selectedTask.id) : [];
  const selectedTaskBlockers = selectedTask ? data.taskBlockers.filter((blocker) => blocker.taskId === selectedTask.id) : [];

  const openTaskPanel = useCallback((taskId: string, mode: TaskPanelOpenMode = "start") => {
    const normalizedHistory = normalizeTaskPanelHistory(taskPanelHistory, availableTaskIds);
    const nextHistory = mode === "push"
      ? pushTaskPanelHistory(normalizedHistory, taskId, availableTaskIds)
      : startTaskPanelHistory(taskId, availableTaskIds);
    const nextTaskId = currentTaskPanelId(nextHistory);
    if (!nextTaskId) return;
    setTaskPanelHistory(nextHistory);
    setSelectedTaskId(nextTaskId);
  }, [availableTaskIds, setSelectedTaskId, taskPanelHistory]);

  const closeTaskPanel = useCallback(() => {
    setTaskPanelHistory(closeTaskPanelHistory());
    setSelectedTaskId(null);
  }, [setSelectedTaskId]);

  const backTaskPanel = useCallback(() => {
    const normalizedHistory = normalizeTaskPanelHistory(taskPanelHistory, availableTaskIds);
    const nextHistory = backTaskPanelHistory(normalizedHistory);
    const nextTaskId = currentTaskPanelId(nextHistory);
    if (!nextTaskId || nextHistory.length === normalizedHistory.length) return;
    setTaskPanelHistory(nextHistory);
    setSelectedTaskId(nextTaskId);
  }, [availableTaskIds, setSelectedTaskId, taskPanelHistory]);

  useEffect(() => {
    if (!selectedTaskId) return;

    const closeOnBackspace = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditable = target?.closest("input, textarea, select, [contenteditable='true']");
      if (isEditable || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== "Backspace") return;

      event.preventDefault();
      if (taskPanelHistory.length > 1) backTaskPanel();
      else closeTaskPanel();
    };

    window.addEventListener("keydown", closeOnBackspace);
    return () => window.removeEventListener("keydown", closeOnBackspace);
  }, [backTaskPanel, closeTaskPanel, selectedTaskId, taskPanelHistory.length]);

  const previousTaskId = taskPanelHistory.length > 1 ? taskPanelHistory[taskPanelHistory.length - 2] : "";
  const previousTask = data.tasks.find((task) => task.id === previousTaskId) || null;

  return {
    backTaskPanel,
    closeTaskPanel,
    openTaskPanel,
    selectedPackage,
    selectedTask,
    selectedTaskActivity,
    selectedTaskBlockers,
    selectedTaskComments,
    selectedTaskExternalComments,
    taskPanelPreviousTask: previousTask,
    selectedTaskSubIssues,
  };
}
