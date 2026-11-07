"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { initiativeForPlanningItem, sortTasks } from "@/features/planning/model/planning-app-model";
import {
  backTaskPanelHistory,
  closeTaskPanelHistory,
  currentTaskPanelId,
  normalizeTaskPanelHistory,
  pushTaskPanelHistory,
  startTaskPanelHistory,
  type TaskPanelOpenMode,
} from "@/features/tasks/model/task-panel-selection";
import type { PlanningState } from "@/features/planning/model/planning-state";
import type { PlanningShellState } from "@/lib/types";

type UsePlanningTaskSelectionOptions = {
  data: PlanningShellState;
  planningState: PlanningState;
  selectedTaskId: string | null;
  setSelectedTaskId: (taskId: string | null) => void;
};

export function usePlanningTaskSelection({
  data,
  planningState,
  selectedTaskId,
  setSelectedTaskId,
}: UsePlanningTaskSelectionOptions) {
  const [taskPanelHistory, setTaskPanelHistory] = useState<string[]>([]);
  const taskPanelReturnFocusRef = useRef<HTMLElement | null>(null);
  const selectedTask = data.tasks.find((task) => task.id === selectedTaskId) || null;
  const selectedInitiative = initiativeForPlanningItem(data.tasks, selectedTask);
  const selectedDetail = selectedTask ? planningState.taskDetail(selectedTask.id) : null;
  const selectedTaskSubIssues = selectedTask ? sortTasks(selectedDetail && selectedDetail.childrenReadStatus !== "not-loaded" && selectedDetail.childrenReadStatus !== "loading"
    ? [...selectedDetail.children]
    : data.tasks.filter((task) => task.parentTaskId === selectedTask.id)) : [];
  const selectedTaskComments = selectedTask ? data.taskComments.filter((comment) => comment.taskId === selectedTask.id) : [];
  const selectedTaskExternalComments = selectedTask ? data.taskExternalComments.filter((comment) => comment.taskId === selectedTask.id) : [];
  const selectedTaskActivity = selectedTask ? data.taskActivity.filter((activity) => activity.taskId === selectedTask.id) : [];
  const selectedTaskBlockers = selectedTask ? data.taskBlockers.filter((blocker) => blocker.taskId === selectedTask.id) : [];

  const openTaskPanel = useCallback((taskId: string, mode: TaskPanelOpenMode = "start") => {
    if (planningState.taskDetail(taskId).removed) return;
    if (mode === "start") taskPanelReturnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const normalizedHistory = normalizeTaskPanelHistory(taskPanelHistory, new Set(taskPanelHistory.filter(taskId => planningState.taskDetail(taskId).removed)));
    const nextHistory = mode === "push"
      ? pushTaskPanelHistory(normalizedHistory, taskId)
      : startTaskPanelHistory(taskId);
    const nextTaskId = currentTaskPanelId(nextHistory);
    if (!nextTaskId) return;
    setTaskPanelHistory(nextHistory);
    setSelectedTaskId(nextTaskId);
  }, [planningState, setSelectedTaskId, taskPanelHistory]);

  const closeTaskPanel = useCallback(() => {
    setTaskPanelHistory(closeTaskPanelHistory());
    setSelectedTaskId(null);
  }, [setSelectedTaskId]);

  const backTaskPanel = useCallback(() => {
    const normalizedHistory = normalizeTaskPanelHistory(taskPanelHistory, new Set(taskPanelHistory.filter(taskId => planningState.taskDetail(taskId).removed)));
    const nextHistory = backTaskPanelHistory(normalizedHistory);
    const nextTaskId = currentTaskPanelId(nextHistory);
    if (!nextTaskId || nextHistory.length === normalizedHistory.length) return;
    setTaskPanelHistory(nextHistory);
    setSelectedTaskId(nextTaskId);
  }, [planningState, setSelectedTaskId, taskPanelHistory]);

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
    selectedInitiative,
    selectedTask,
    selectedTaskActivity,
    selectedTaskBlockers,
    selectedTaskComments,
    selectedTaskExternalComments,
    taskPanelPreviousTask: previousTask,
    taskPanelReturnFocusRef,
    selectedTaskSubIssues,
  };
}
