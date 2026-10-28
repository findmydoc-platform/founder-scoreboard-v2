"use client";
import { useCallback, useEffect, useRef } from "react";
import type { PlanningState } from "@/features/planning/model/planning-state";
export function useBacklogModel(planningState: PlanningState) {
  const requested = useRef(false), shared = planningState.backlog();
  const refresh = useCallback(async () => { await planningState.refreshWorkspace("backlog"); }, [planningState]);
  useEffect(() => {
    if (!requested.current && shared.readStatus !== "loading") { requested.current = true; if (!shared.model.coverage?.items) void refresh(); }
  }, [refresh, shared.readStatus, shared.model.coverage?.items]);
  return shared.model;
}
