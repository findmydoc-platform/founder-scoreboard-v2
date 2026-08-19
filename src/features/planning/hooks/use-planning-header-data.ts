"use client";

import type { User } from "@supabase/supabase-js";
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import * as planningApi from "@/features/planning/model/planning-api-client";
import { setProtectedPlanningShellStateCache } from "@/features/planning/hooks/use-planning-auth";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import {
  idlePlanningHeaderSlots,
  markPlanningHeaderDataError,
  markPlanningHeaderDataLoading,
  mergePlanningHeaderData,
  normalizePlanningHeaderData,
  projectPlanningHeaderData,
  type PlanningHeaderSlotKey,
} from "@/lib/planning-header-data";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import type { AuthenticatedProfile, PlanningShellState, PlanningHeaderData } from "@/lib/types";

type UsePlanningHeaderDataOptions = {
  apiClient: BrowserApiClient;
  authRequired: boolean;
  authUser: User | null;
  baseHeaderData: PlanningHeaderData;
  currentProfileId: string;
  data: PlanningShellState;
  protectedDataLoaded: boolean;
  refreshNotificationsWorkspace?: () => Promise<void>;
  serverCurrentProfile: AuthenticatedProfile | null;
  setHeaderData: Dispatch<SetStateAction<PlanningHeaderData>>;
  workspace: AppWorkspace;
};

export function usePlanningHeaderData({
  apiClient,
  authRequired,
  authUser,
  baseHeaderData,
  currentProfileId,
  data,
  protectedDataLoaded,
  refreshNotificationsWorkspace,
  serverCurrentProfile,
  setHeaderData,
  workspace,
}: UsePlanningHeaderDataOptions) {
  const [loadingSlots, setLoadingSlots] = useState<PlanningHeaderSlotKey[]>([]);
  const inFlightKeyRef = useRef("");
  const notificationRefreshInFlightRef = useRef(false);
  const dataRef = useRef(data);
  const serverCurrentProfileRef = useRef(serverCurrentProfile);
  const authUserId = authUser?.id || "";
  useEffect(() => {
    dataRef.current = data;
    serverCurrentProfileRef.current = serverCurrentProfile;
  }, [data, serverCurrentProfile]);
  const projectedHeaderData = useMemo(
    () => projectPlanningHeaderData(data, baseHeaderData, {
      currentProfileId,
      platformRole: serverCurrentProfile?.platformRole || null,
      fmdToolsLoaded: workspace === "tools",
      eventsLoaded: workspace === "events",
      notificationEventsLoaded: workspace === "notifications",
    }),
    [baseHeaderData, currentProfileId, data, serverCurrentProfile?.platformRole, workspace],
  );

  const headerData = useMemo(
    () => loadingSlots.length ? markPlanningHeaderDataLoading(projectedHeaderData, loadingSlots) : projectedHeaderData,
    [loadingSlots, projectedHeaderData],
  );
  const idleSlots = useMemo(() => idlePlanningHeaderSlots(projectedHeaderData), [projectedHeaderData]);
  const idleSlotKey = idleSlots.join(",");

  useEffect(() => {
    if (!authUserId) return;
    if (authRequired && !protectedDataLoaded) return;
    if (!idleSlotKey) return;

    if (inFlightKeyRef.current === idleSlotKey) return;

    const requestedSlots = idleSlotKey.split(",") as PlanningHeaderSlotKey[];
    inFlightKeyRef.current = idleSlotKey;
    const controller = new AbortController();
    let active = true;

    setLoadingSlots(requestedSlots);

    async function loadHeaderData() {
      try {
        const { response, body } = await planningApi.requestPlanningHeaderData(apiClient, requestedSlots, {
          signal: controller.signal,
        });
        if (!active) return;
        inFlightKeyRef.current = "";
        setLoadingSlots([]);
        if (!response.ok || !body?.headerData) {
          setHeaderData((current) => markPlanningHeaderDataError(current, requestedSlots, body?.error || "Headerdaten konnten nicht geladen werden."));
          return;
        }

        const nextHeaderData = normalizePlanningHeaderData(body.headerData);
        setHeaderData((current) => {
          const mergedHeaderData = mergePlanningHeaderData(current, nextHeaderData);
          setProtectedPlanningShellStateCache({
            authUserId,
            currentProfile: serverCurrentProfileRef.current,
            data: dataRef.current,
            headerData: mergedHeaderData,
          });
          return mergedHeaderData;
        });
      } catch (error) {
        if (!active || error instanceof DOMException && error.name === "AbortError") return;
        inFlightKeyRef.current = "";
        setLoadingSlots([]);
        setHeaderData((current) => markPlanningHeaderDataError(current, requestedSlots, "Headerdaten konnten nicht geladen werden."));
      }
    }

    loadHeaderData();

    return () => {
      active = false;
      controller.abort();
      if (inFlightKeyRef.current === idleSlotKey) inFlightKeyRef.current = "";
      setLoadingSlots([]);
    };
  }, [apiClient, authRequired, authUserId, idleSlotKey, protectedDataLoaded, setHeaderData]);

  useEffect(() => {
    if (!authUserId) return;
    if (authRequired && !protectedDataLoaded) return;

    let active = true;
    const controller = new AbortController();
    const refreshNotifications = async () => {
      if (!active || notificationRefreshInFlightRef.current) return;
      notificationRefreshInFlightRef.current = true;
      try {
        if (workspace === "notifications" && refreshNotificationsWorkspace) {
          await refreshNotificationsWorkspace();
          return;
        }
        const { response, body } = await planningApi.requestPlanningHeaderData(apiClient, ["notifications"], {
          signal: controller.signal,
        });
        if (!active || !response.ok || !body?.headerData) return;
        const nextHeaderData = normalizePlanningHeaderData(body.headerData);
        setHeaderData((current) => {
          const mergedHeaderData = mergePlanningHeaderData(current, nextHeaderData);
          setProtectedPlanningShellStateCache({
            authUserId,
            currentProfile: serverCurrentProfileRef.current,
            data: dataRef.current,
            headerData: mergedHeaderData,
          });
          return mergedHeaderData;
        });
      } catch (error) {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
          // Keep the last successfully loaded notification state; the next poll retries.
        }
      } finally {
        notificationRefreshInFlightRef.current = false;
      }
    };
    const interval = window.setInterval(refreshNotifications, 60_000);
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshNotifications();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      active = false;
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      notificationRefreshInFlightRef.current = false;
    };
  }, [apiClient, authRequired, authUserId, protectedDataLoaded, refreshNotificationsWorkspace, setHeaderData, workspace]);

  return headerData;
}
