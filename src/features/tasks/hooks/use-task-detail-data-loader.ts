"use client";

import { useEffect, useState, type TransitionStartFunction } from "react";
import { requestTaskDetailData } from "@/features/tasks/model/task-api-client";
import { applyTaskDetailModel, taskDetailDegradationMessage } from "@/features/tasks/model/task-detail-planning-shell-projection";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { PlanningShellState, Task } from "@/lib/types";

type UseTaskDetailDataLoaderOptions = {
  apiClient: BrowserApiClient;
  applyPlanningShellStateUpdate: (updater: (current: PlanningShellState) => PlanningShellState) => void;
  selectedTask: Task | null;
  source: "supabase";
  startTransition: TransitionStartFunction;
};

export function useTaskDetailDataLoader({
  apiClient,
  applyPlanningShellStateUpdate,
  selectedTask,
  source,
  startTransition,
}: UseTaskDetailDataLoaderOptions) {
  const [loadedTaskIds, setLoadedTaskIds] = useState<Set<string>>(() => new Set());
  const [loadState, setLoadState] = useState({ taskId: "", loading: false, error: "" });
  const selectedTaskId = selectedTask?.id || "";

  useEffect(() => {
    if (!selectedTaskId) return;
    if (source !== "supabase" || loadedTaskIds.has(selectedTaskId)) {
      return;
    }

    let active = true;
    window.queueMicrotask(() => {
      if (active) setLoadState({ taskId: selectedTaskId, loading: true, error: "" });
    });

    startTransition(async () => {
      try {
        const { response, body } = await requestTaskDetailData(apiClient, selectedTaskId);
        if (!active) return;
        if (!response.ok || !body?.taskDetail) throw new Error(body?.error || "Task-Details konnten nicht geladen werden.");

        applyPlanningShellStateUpdate((current) => applyTaskDetailModel(current, body.taskDetail!));
        setLoadedTaskIds((current) => {
          if (current.has(selectedTaskId)) return current;
          const next = new Set(current);
          next.add(selectedTaskId);
          return next;
        });
        setLoadState({
          taskId: selectedTaskId,
          loading: false,
          error: taskDetailDegradationMessage(body.unavailable || []),
        });
      } catch (caught) {
        if (!active) return;
        setLoadState({
          taskId: selectedTaskId,
          loading: false,
          error: caught instanceof Error ? caught.message : "Task-Details konnten nicht geladen werden.",
        });
      }
    });

    return () => {
      active = false;
    };
  }, [apiClient, applyPlanningShellStateUpdate, loadedTaskIds, selectedTaskId, source, startTransition]);

  const selectedStateMatches = loadState.taskId === selectedTaskId;
  const selectedTaskNeedsLoad = Boolean(
    selectedTaskId
    && source === "supabase"
    && !loadedTaskIds.has(selectedTaskId),
  );

  return {
    selectedTaskDetailError: selectedStateMatches ? loadState.error : "",
    selectedTaskDetailLoading: selectedTaskNeedsLoad && (!selectedStateMatches || loadState.loading),
  };
}
