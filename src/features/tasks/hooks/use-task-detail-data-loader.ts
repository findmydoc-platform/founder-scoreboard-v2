"use client";

import { useEffect, useRef, useState, type TransitionStartFunction } from "react";
import { requestTaskDetailData, mergeTaskDetailData } from "@/features/tasks/model/task-api-client";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { PlanningData, Task } from "@/lib/types";

type UseTaskDetailDataLoaderOptions = {
  apiClient: BrowserApiClient;
  applyPlanningDataUpdate: (updater: (current: PlanningData) => PlanningData) => void;
  selectedTask: Task | null;
  source: "seed" | "supabase";
  startTransition: TransitionStartFunction;
};

export function useTaskDetailDataLoader({
  apiClient,
  applyPlanningDataUpdate,
  selectedTask,
  source,
  startTransition,
}: UseTaskDetailDataLoaderOptions) {
  const loadedTaskIdsRef = useRef<Set<string>>(new Set());
  const [loadState, setLoadState] = useState({ taskId: "", loading: false, error: "" });
  const selectedTaskId = selectedTask?.id || "";

  useEffect(() => {
    if (!selectedTaskId) return;
    if (source !== "supabase" || loadedTaskIdsRef.current.has(selectedTaskId)) {
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
        if (!response.ok || !body?.detailData) throw new Error(body?.error || "Task-Details konnten nicht geladen werden.");

        applyPlanningDataUpdate((current) => mergeTaskDetailData(current, selectedTaskId, body.detailData!));
        loadedTaskIdsRef.current.add(selectedTaskId);
        setLoadState({ taskId: selectedTaskId, loading: false, error: "" });
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
  }, [apiClient, applyPlanningDataUpdate, selectedTaskId, source, startTransition]);

  return {
    selectedTaskDetailError: loadState.taskId === selectedTaskId ? loadState.error : "",
    selectedTaskDetailLoading: Boolean(selectedTaskId && loadState.taskId === selectedTaskId && loadState.loading),
  };
}
