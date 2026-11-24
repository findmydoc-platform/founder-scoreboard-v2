"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlanningState } from "../model/planning-state";

type UsePlanningRemoteChangesOptions = {
  planningState: PlanningState;
  enabled: boolean;
  refreshCurrentWorkspaceModel: () => Promise<void>;
  scopeRevision?: string;
  authoritativeRevision?: import("../model/planning-revision").PlanningTaskRevision;
};

export function usePlanningRemoteChanges({
  planningState,
  enabled,
  refreshCurrentWorkspaceModel,
  scopeRevision,
  authoritativeRevision,
}: UsePlanningRemoteChangesOptions) {
  const [planningRemoteChangesAvailable, setPlanningRemoteChangesAvailable] = useState(false);
  const [planningRemoteChangesRefreshing, setPlanningRemoteChangesRefreshing] = useState(false);
  const contextRef = useRef(0);
  const checkingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    contextRef.current++;
  }, [scopeRevision, authoritativeRevision, planningState, enabled]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const checkForPlanningRemoteChanges = useCallback(async () => {
    if (!enabled || document.visibilityState === "hidden" || !mountedRef.current || checkingRef.current) return;
    checkingRef.current = true;
    const context = contextRef.current;
    try {
      const result = await planningState.checkPlanningSource();
      if (!mountedRef.current || context !== contextRef.current) return;
      if (result === "changed") setPlanningRemoteChangesAvailable(true);
      else if (result === "unchanged" || result === "content-read") setPlanningRemoteChangesAvailable(false);
    } catch {
      // Connectivity failures leave the current view unchanged and retry on the next check.
    } finally {
      checkingRef.current = false;
    }
  }, [planningState, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    queueMicrotask(() => { if (active) void checkForPlanningRemoteChanges(); });
    const interval = window.setInterval(() => void checkForPlanningRemoteChanges(), 60_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkForPlanningRemoteChanges();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleVisibilityChange);
    };
  }, [checkForPlanningRemoteChanges, enabled]);

  const refreshPlanningRemoteChanges = useCallback(async () => {
    if (planningRemoteChangesRefreshing) return;
    setPlanningRemoteChangesRefreshing(true);
    try {
      await refreshCurrentWorkspaceModel();
      if (mountedRef.current && planningState.board().readStatus === "current") setPlanningRemoteChangesAvailable(false);
    } finally {
      if (mountedRef.current) setPlanningRemoteChangesRefreshing(false);
      if (mountedRef.current) window.setTimeout(() => void checkForPlanningRemoteChanges(), 500);
    }
  }, [checkForPlanningRemoteChanges, planningState, planningRemoteChangesRefreshing, refreshCurrentWorkspaceModel]);

  return {
    planningRemoteChangesAvailable,
    planningRemoteChangesUnverified: planningState.board().sourceStatus === "unverified",
    checkForPlanningRemoteChanges,
    planningRemoteChangesRefreshing,
    refreshPlanningRemoteChanges,
  };
}
