"use client";

import type { User } from "@supabase/supabase-js";
import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import * as planningApi from "@/features/planning/model/planning-api-client";
import { setProtectedPlanningDataCache } from "@/features/planning/hooks/use-planning-auth";
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
import type { AuthenticatedProfile, PlanningData, PlanningHeaderData } from "@/lib/types";

type UsePlanningHeaderDataOptions = {
  apiClient: BrowserApiClient;
  authRequired: boolean;
  authUser: User | null;
  baseHeaderData: PlanningHeaderData;
  currentProfileId: string;
  data: PlanningData;
  protectedDataLoaded: boolean;
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
  serverCurrentProfile,
  setHeaderData,
  workspace,
}: UsePlanningHeaderDataOptions) {
  const [loadingSlots, setLoadingSlots] = useState<PlanningHeaderSlotKey[]>([]);
  const inFlightKeyRef = useRef("");
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
    if (!authUser?.id) return;
    if (authRequired && !protectedDataLoaded) return;
    if (!idleSlotKey) return;

    if (inFlightKeyRef.current === idleSlotKey) return;

    const authUserId = authUser.id;
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
          setProtectedPlanningDataCache({
            authUserId,
            currentProfile: serverCurrentProfile,
            data,
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
  }, [apiClient, authRequired, authUser, data, idleSlotKey, protectedDataLoaded, serverCurrentProfile, setHeaderData]);

  return headerData;
}
