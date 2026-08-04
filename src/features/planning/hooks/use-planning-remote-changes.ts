"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as planningApi from "@/features/planning/model/planning-api-client";
import { planningTaskRevision, planningTaskRevisionsEqual } from "@/features/planning/model/planning-data-revision";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { Task } from "@/lib/types";

type UsePlanningRemoteChangesOptions = {
  apiClient: BrowserApiClient;
  enabled: boolean;
  refreshPlanningData: () => Promise<void>;
  tasks: Task[];
};

export function usePlanningRemoteChanges({
  apiClient,
  enabled,
  refreshPlanningData,
  tasks,
}: UsePlanningRemoteChangesOptions) {
  const [planningRemoteChangesAvailable, setPlanningRemoteChangesAvailable] = useState(false);
  const [planningRemoteChangesRefreshing, setPlanningRemoteChangesRefreshing] = useState(false);
  const currentRevision = useMemo(() => planningTaskRevision(tasks), [tasks]);
  const currentRevisionRef = useRef(currentRevision);
  const checkingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    currentRevisionRef.current = currentRevision;
  }, [currentRevision]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const checkForPlanningRemoteChanges = useCallback(async () => {
    if (!enabled || !mountedRef.current || checkingRef.current) return;
    checkingRef.current = true;
    try {
      const { response, body } = await planningApi.requestPlanningDataRevision(apiClient);
      if (!mountedRef.current || !response.ok || !body?.revision) return;
      setPlanningRemoteChangesAvailable(!planningTaskRevisionsEqual(body.revision, currentRevisionRef.current));
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
      await refreshPlanningData();
      if (mountedRef.current) setPlanningRemoteChangesAvailable(false);
    } finally {
      if (mountedRef.current) setPlanningRemoteChangesRefreshing(false);
      if (mountedRef.current) window.setTimeout(() => void checkForPlanningRemoteChanges(), 500);
    }
  }, [checkForPlanningRemoteChanges, planningRemoteChangesRefreshing, refreshPlanningData]);

  return {
    planningRemoteChangesAvailable,
    planningRemoteChangesRefreshing,
    refreshPlanningRemoteChanges,
  };
}
