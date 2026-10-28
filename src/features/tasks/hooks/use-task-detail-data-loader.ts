"use client";

import { useCallback, useEffect, useState, type TransitionStartFunction } from "react";
import { taskDetailDegradationMessage } from "@/features/tasks/model/task-detail-planning-shell-projection";
import type { PlanningState } from "@/features/planning/model/planning-state";
import type { Task } from "@/lib/types";

type UseTaskDetailDataLoaderOptions = {
  planningState: PlanningState;
  selectedTask: Task | null;
  source: "supabase";
  startTransition: TransitionStartFunction;
};

export function useTaskDetailDataLoader({
  planningState,
  selectedTask,
  source,
  startTransition,
}: UseTaskDetailDataLoaderOptions) {
  const [loadedTaskIds, setLoadedTaskIds] = useState<Set<string>>(() => new Set());
  const [attempt, setAttempt] = useState(0);
  const [loadState, setLoadState] = useState({ taskId: "", loading: false, error: "" });
  const selectedTaskId = selectedTask?.id || "";
  const selectedTaskIsSummary = (selectedTask?.detailAvailability === "summary" || selectedTask?.detailAvailability === "stale");
  const retrySelectedTaskDetail = useCallback(() => {
    setLoadedTaskIds((current) => {
      if (!current.has(selectedTaskId)) return current;
      const next = new Set(current);
      next.delete(selectedTaskId);
      return next;
    });
    setAttempt((current) => current + 1);
  }, [selectedTaskId]);

  useEffect(() => {
    if (!selectedTaskId) return;
    if (source !== "supabase" || (loadedTaskIds.has(selectedTaskId) && !selectedTaskIsSummary)) {
      return;
    }

    let active = true;
    window.queueMicrotask(() => {
      if (active) setLoadState({ taskId: selectedTaskId, loading: true, error: "" });
    });

    startTransition(async () => {
      try {
        const result = await planningState.loadTaskDetail(selectedTaskId);
        if (!active) return;
        if (!result.ok) {
          setLoadState({ taskId: selectedTaskId, loading: false, error: result.error || "Task-Details konnten nicht geladen werden." });
          return;
        }
        setLoadedTaskIds((current) => {
          if (current.has(selectedTaskId)) return current;
          const next = new Set(current);
          next.add(selectedTaskId);
          return next;
        });
        setLoadState({
          taskId: selectedTaskId,
          loading: false,
          error: taskDetailDegradationMessage(result.unavailable || []),
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
  }, [planningState, attempt, loadedTaskIds, selectedTaskId, selectedTaskIsSummary, source, startTransition]);

  const selectedStateMatches = loadState.taskId === selectedTaskId;
  const selectedTaskNeedsLoad = Boolean(
    selectedTaskId
    && source === "supabase"
    && (!loadedTaskIds.has(selectedTaskId) || selectedTaskIsSummary),
  );

  return {
    retrySelectedTaskDetail,
    selectedTaskDetailError: selectedStateMatches ? loadState.error : "",
    selectedTaskDetailLoading: selectedTaskNeedsLoad && (!selectedStateMatches || loadState.loading),
  };
}
