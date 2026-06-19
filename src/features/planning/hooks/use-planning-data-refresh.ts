"use client";

import type { User } from "@supabase/supabase-js";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { AuthenticatedProfile, PlanningData } from "@/lib/types";
import * as planningApi from "@/features/planning/model/planning-api-client";
import { setProtectedPlanningDataCache } from "@/features/planning/hooks/use-planning-auth";
import { normalizePlanningData } from "@/features/planning/model/planning-app-model";

type UsePlanningDataRefreshOptions = {
  apiClient: BrowserApiClient;
  authUser: User | null;
  serverCurrentProfile: AuthenticatedProfile | null;
  setData: Dispatch<SetStateAction<PlanningData>>;
  setProtectedDataLoaded: Dispatch<SetStateAction<boolean>>;
  source: "seed" | "supabase";
};

export function usePlanningDataRefresh({
  apiClient,
  authUser,
  serverCurrentProfile,
  setData,
  setProtectedDataLoaded,
  source,
}: UsePlanningDataRefreshOptions) {
  const applyPlanningDataUpdate = useCallback((updater: (current: PlanningData) => PlanningData) => {
    setData((current) => {
      const nextData = updater(current);
      if (source === "supabase" && authUser?.id) {
        setProtectedPlanningDataCache({
          authUserId: authUser.id,
          data: nextData,
          currentProfile: serverCurrentProfile,
        });
      }
      return nextData;
    });
  }, [authUser, serverCurrentProfile, setData, source]);

  const refreshPlanningData = useCallback(async () => {
    if (source !== "supabase" || !authUser?.id) return;
    const { response: refreshResponse, body: refreshPayload } = await planningApi.requestPlanningData(apiClient);
    if (!refreshResponse.ok || !refreshPayload?.data) return;
    const nextData = normalizePlanningData(refreshPayload.data);
    setProtectedPlanningDataCache({
      authUserId: authUser.id,
      data: nextData,
      currentProfile: refreshPayload.currentProfile || serverCurrentProfile,
    });
    setData(nextData);
    setProtectedDataLoaded(true);
  }, [apiClient, authUser, serverCurrentProfile, setData, setProtectedDataLoaded, source]);

  return { applyPlanningDataUpdate, refreshPlanningData };
}
