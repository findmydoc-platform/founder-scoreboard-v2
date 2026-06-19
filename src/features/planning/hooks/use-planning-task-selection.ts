"use client";

import { useCallback, useEffect } from "react";
import type { AppWorkspace } from "@/features/planning/organisms/app-sidebar";
import { packageById, sortTasks } from "@/features/planning/model/planning-app-model";
import type { PlanningData, Task } from "@/lib/types";

type PlanningTaskSelectionRouter = {
  back: () => void;
  push: (href: string) => void;
};

type UsePlanningTaskSelectionOptions = {
  data: PlanningData;
  fullTaskView: boolean;
  pathname: string | null;
  router: PlanningTaskSelectionRouter;
  selectedReviewDetailTaskId: string;
  selectedTaskId: string | null;
  setFocusedReviewTaskId: (taskId: string) => void;
  setSelectedTaskId: (taskId: string | null) => void;
  setWorkspace: (workspace: AppWorkspace) => void;
};

export function usePlanningTaskSelection({
  data,
  fullTaskView,
  pathname,
  router,
  selectedReviewDetailTaskId,
  selectedTaskId,
  setFocusedReviewTaskId,
  setSelectedTaskId,
  setWorkspace,
}: UsePlanningTaskSelectionOptions) {
  const selectedTask = data.tasks.find((task) => task.id === selectedTaskId) || null;
  const selectedReviewDetailTask = data.tasks.find((task) => task.id === selectedReviewDetailTaskId) || null;
  const selectedPackage = selectedTask ? packageById(data.packages, selectedTask.packageId) : undefined;
  const selectedTaskSubIssues = selectedTask ? sortTasks(data.tasks.filter((task) => task.parentTaskId === selectedTask.id)) : [];
  const selectedTaskComments = selectedTask ? data.taskComments.filter((comment) => comment.taskId === selectedTask.id) : [];
  const selectedTaskExternalComments = selectedTask ? data.taskExternalComments.filter((comment) => comment.taskId === selectedTask.id) : [];
  const selectedTaskActivity = selectedTask ? data.taskActivity.filter((activity) => activity.taskId === selectedTask.id) : [];
  const selectedTaskBlockers = selectedTask ? data.taskBlockers.filter((blocker) => blocker.taskId === selectedTask.id) : [];

  const openTaskPanel = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
    router.push(`/tasks/${encodeURIComponent(taskId)}`);
  }, [router, setSelectedTaskId]);

  const closeTaskPanel = useCallback(() => {
    setSelectedTaskId(null);
    if (pathname?.startsWith("/tasks/")) {
      if (window.history.length > 1) {
        router.back();
      } else {
        router.push("/");
      }
    }
  }, [pathname, router, setSelectedTaskId]);

  const openReviewSheet = useCallback((task: Task) => {
    setSelectedTaskId(null);
    setFocusedReviewTaskId(task.id);
    setWorkspace("reviews");
    router.push(`/reviews/${encodeURIComponent(task.id)}`);
  }, [router, setFocusedReviewTaskId, setSelectedTaskId, setWorkspace]);

  useEffect(() => {
    if (!selectedTaskId) return;

    const closeOnBackspace = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditable = target?.closest("input, textarea, select, [contenteditable='true']");
      if (isEditable || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== "Backspace") return;

      event.preventDefault();
      closeTaskPanel();
    };

    window.addEventListener("keydown", closeOnBackspace);
    return () => window.removeEventListener("keydown", closeOnBackspace);
  }, [closeTaskPanel, selectedTaskId]);

  return {
    closeTaskPanel,
    fullTaskView,
    openReviewSheet,
    openTaskPanel,
    selectedPackage,
    selectedReviewDetailTask,
    selectedTask,
    selectedTaskActivity,
    selectedTaskBlockers,
    selectedTaskComments,
    selectedTaskExternalComments,
    selectedTaskSubIssues,
  };
}
