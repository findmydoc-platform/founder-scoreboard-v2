"use client";

import type { User } from "@supabase/supabase-js";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { AuthenticatedProfile, PlanningData, PlanningHeaderData } from "@/lib/types";
import * as planningApi from "@/features/planning/model/planning-api-client";
import { setProtectedPlanningDataCache } from "@/features/planning/hooks/use-planning-auth";
import { normalizePlanningData } from "@/features/planning/model/planning-app-model";
import { mergePlanningHeaderData, normalizePlanningHeaderData } from "@/lib/planning-header-data";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";

type UsePlanningDataRefreshOptions = {
  apiClient: BrowserApiClient;
  authUser: User | null;
  headerData: PlanningHeaderData;
  serverCurrentProfile: AuthenticatedProfile | null;
  setData: Dispatch<SetStateAction<PlanningData>>;
  setHeaderData: Dispatch<SetStateAction<PlanningHeaderData>>;
  setProtectedDataLoaded: Dispatch<SetStateAction<boolean>>;
  source: "supabase";
  workspace: AppWorkspace;
};

export function usePlanningDataRefresh({
  apiClient,
  authUser,
  headerData,
  serverCurrentProfile,
  setData,
  setHeaderData,
  setProtectedDataLoaded,
  source,
  workspace,
}: UsePlanningDataRefreshOptions) {
  const applyPlanningDataUpdate = useCallback((updater: (current: PlanningData) => PlanningData) => {
    setData((current) => {
      const nextData = updater(current);
      if (source === "supabase" && authUser?.id) {
        setProtectedPlanningDataCache({
          authUserId: authUser.id,
          data: nextData,
          headerData,
          currentProfile: serverCurrentProfile,
        });
      }
      return nextData;
    });
  }, [authUser, headerData, serverCurrentProfile, setData, source]);

  const refreshPlanningData = useCallback(async () => {
    if (source !== "supabase" || !authUser?.id) return;
    const { response: refreshResponse, body: refreshPayload } = await planningApi.requestPlanningData(apiClient, workspace);
    if (!refreshResponse.ok || !refreshPayload?.data) return;
    const nextData = normalizePlanningData(refreshPayload.data);
    const nextHeaderData = mergePlanningHeaderData(headerData, normalizePlanningHeaderData(refreshPayload.headerData));
    setProtectedPlanningDataCache({
      authUserId: authUser.id,
      data: nextData,
      headerData: nextHeaderData,
      currentProfile: refreshPayload.currentProfile || serverCurrentProfile,
    });
    setData(nextData);
    setHeaderData(nextHeaderData);
    setProtectedDataLoaded(true);
  }, [apiClient, authUser, headerData, serverCurrentProfile, setData, setHeaderData, setProtectedDataLoaded, source, workspace]);

  return { applyPlanningDataUpdate, refreshPlanningData };
}
