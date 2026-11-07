"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as planningApi from "@/features/planning/model/planning-api-client";
import { planningTaskRevisionsEqual } from "@/features/planning/model/planning-revision";
import type { BrowserApiClient } from "@/lib/browser-api-client";

type UsePlanningRemoteChangesOptions = {
  apiClient: BrowserApiClient;
  enabled: boolean;
  refreshCurrentWorkspaceModel: () => Promise<void>;
  scopeRevision?: string;
  authoritativeRevision?: import("../model/planning-revision").PlanningTaskRevision;
};

export function usePlanningRemoteChanges({
  apiClient,
  enabled,
  refreshCurrentWorkspaceModel,
  scopeRevision,
  authoritativeRevision,
}: UsePlanningRemoteChangesOptions) {
  const [planningRemoteChangesAvailable, setPlanningRemoteChangesAvailable] = useState(false);
  const [planningRemoteChangesRefreshing, setPlanningRemoteChangesRefreshing] = useState(false);
  const currentRevisionRef = useRef({ scopeRevision, authoritativeRevision });
  const contextRef = useRef(0);
  const checkingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    currentRevisionRef.current = { scopeRevision, authoritativeRevision };
    contextRef.current++;
  }, [scopeRevision, authoritativeRevision, apiClient, enabled]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const checkForPlanningRemoteChanges = useCallback(async () => {
    if (!enabled || !mountedRef.current || checkingRef.current) return;
    checkingRef.current = true;
    const context = contextRef.current;
    try {
      const { response, body } = await planningApi.requestPlanningShellStateRevision(apiClient);
      if (!mountedRef.current || context !== contextRef.current || !response.ok || !body?.revision) return;
      const current = currentRevisionRef.current;
      const remoteScopeRevision = "scopeRevision" in body.revision && typeof body.revision.scopeRevision === "string" ? body.revision.scopeRevision : undefined;
      if (current.scopeRevision && remoteScopeRevision) {
        setPlanningRemoteChangesAvailable(current.scopeRevision !== remoteScopeRevision);
      } else if (current.authoritativeRevision && !planningTaskRevisionsEqual(body.revision, current.authoritativeRevision)) {
        // Legacy metadata can disprove freshness, but equality cannot prove an unchanged source.
        setPlanningRemoteChangesAvailable(true);
      }
    } catch {
      // Connectivity failures leave the current view unchanged and retry on the next check.
    } finally {
      checkingRef.current = false;
    }
  }, [apiClient, enabled]);

  useEffect(() => {
    if (!enabled) return;
    void checkForPlanningRemoteChanges();
    const interval = window.setInterval(() => void checkForPlanningRemoteChanges(), 60_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void checkForPlanningRemoteChanges();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [checkForPlanningRemoteChanges, enabled]);

  const refreshPlanningRemoteChanges = useCallback(async () => {
    if (planningRemoteChangesRefreshing) return;
    setPlanningRemoteChangesRefreshing(true);
    try {
      await refreshCurrentWorkspaceModel();
      if (mountedRef.current) setPlanningRemoteChangesAvailable(false);
    } finally {
      if (mountedRef.current) setPlanningRemoteChangesRefreshing(false);
      if (mountedRef.current) window.setTimeout(() => void checkForPlanningRemoteChanges(), 500);
    }
  }, [checkForPlanningRemoteChanges, planningRemoteChangesRefreshing, refreshCurrentWorkspaceModel]);

  return {
    planningRemoteChangesAvailable,
    planningRemoteChangesRefreshing,
    refreshPlanningRemoteChanges,
  };
}
