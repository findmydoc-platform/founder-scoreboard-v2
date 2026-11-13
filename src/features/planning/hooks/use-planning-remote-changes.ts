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
      return result;
    } catch {
      // Connectivity failures leave the current view unchanged and retry on the next check.
    } finally {
      checkingRef.current = false;
    }
  }, [planningState, enabled]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let release: (() => void) | undefined;
    let interval: number | undefined;
    const visible = () => {
      if (document.visibilityState === "hidden") {
        release?.(); release = undefined;
        if (interval !== undefined) window.clearInterval(interval);
        interval = undefined;
        return;
      }
      release ||= planningState.activatePlanningView();
      interval ??= window.setInterval(() => void checkForPlanningRemoteChanges(), 60_000);
      void checkForPlanningRemoteChanges();
    };
    queueMicrotask(() => { if (active) visible(); });
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", visible);
    return () => {
      active = false;
      release?.();
      if (interval !== undefined) window.clearInterval(interval);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", visible);
    };
  }, [checkForPlanningRemoteChanges, enabled, planningState]);

  const refreshPlanningRemoteChanges = useCallback(async () => {
    if (planningRemoteChangesRefreshing) return;
    setPlanningRemoteChangesRefreshing(true);
    try {
      await refreshCurrentWorkspaceModel();
    } finally {
      if (mountedRef.current) setPlanningRemoteChangesRefreshing(false);
    }
  }, [planningRemoteChangesRefreshing, refreshCurrentWorkspaceModel]);

  return {
    planningRemoteChangesAvailable: planningState.board().sourceStatus === "changed",
    planningRemoteChangesUnverified: planningState.board().sourceStatus === "unverified",
    checkForPlanningRemoteChanges,
    planningRemoteChangesRefreshing: planningRemoteChangesRefreshing || planningState.board().readStatus === "loading",
    refreshPlanningRemoteChanges,
  };
}
