"use client";

import type { User } from "@supabase/supabase-js";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { AuthenticatedProfile, PlanningShellState, PlanningHeaderData } from "@/lib/types";
import * as planningApi from "@/features/planning/model/planning-api-client";
import { setProtectedPlanningShellStateCache } from "@/features/planning/hooks/use-planning-auth";
import { normalizePlanningShellState } from "@/features/planning/model/planning-app-model";
import { mergePlanningHeaderData, normalizePlanningHeaderData } from "@/lib/planning-header-data";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import { planningWorkspaceModelToPlanningShellState } from "@/features/planning-items/model/planning-shell-projection";
import { isSupportingWorkspace, supportingWorkspaceModelToPlanningShellState } from "@/features/planning/model/supporting-planning-shell-projection";
import { sprintWorkspaceModelToPlanningShellState } from "@/features/sprint/model/sprint-planning-shell-projection";

type UseCurrentWorkspaceModelRefreshOptions = {
  apiClient: BrowserApiClient;
  authUser: User | null;
  headerData: PlanningHeaderData;
  serverCurrentProfile: AuthenticatedProfile | null;
  setData: Dispatch<SetStateAction<PlanningShellState>>;
  setHeaderData: Dispatch<SetStateAction<PlanningHeaderData>>;
  setProtectedDataLoaded: Dispatch<SetStateAction<boolean>>;
  source: "supabase";
  workspace: AppWorkspace;
};

export function useCurrentWorkspaceModelRefresh({
  apiClient,
  authUser,
  headerData,
  serverCurrentProfile,
  setData,
  setHeaderData,
  setProtectedDataLoaded,
  source,
  workspace,
}: UseCurrentWorkspaceModelRefreshOptions) {
  const applyPlanningShellStateUpdate = useCallback((updater: (current: PlanningShellState) => PlanningShellState) => {
    setData((current) => {
      const nextData = updater(current);
      if (source === "supabase" && authUser?.id) {
        setProtectedPlanningShellStateCache({
          authUserId: authUser.id,
          data: nextData,
          headerData,
          currentProfile: serverCurrentProfile,
        });
      }
      return nextData;
    });
  }, [authUser, headerData, serverCurrentProfile, setData, source]);

  const refreshCurrentWorkspaceModelWithResult = useCallback(async () => {
    if (source !== "supabase" || !authUser?.id) return false;
    if (workspace === "planning" || workspace === "projects") {
      const { response, body } = await planningApi.requestPlanningWorkspaceData(apiClient, workspace);
      if (!response.ok || !body?.model) return false;
      const nextData = normalizePlanningShellState(planningWorkspaceModelToPlanningShellState(body.model));
      const nextHeaderData = mergePlanningHeaderData(headerData, normalizePlanningHeaderData(body.headerData));
      setProtectedPlanningShellStateCache({
        authUserId: authUser.id,
        data: nextData,
        headerData: nextHeaderData,
        currentProfile: body.currentProfile || serverCurrentProfile,
      });
      setData(nextData);
      setHeaderData(nextHeaderData);
      setProtectedDataLoaded(true);
      return true;
    }
    if (isSupportingWorkspace(workspace)) {
      const { response, body } = await planningApi.requestSupportingWorkspaceData(apiClient, workspace);
      if (!response.ok || !body?.model) return false;
      const nextData = normalizePlanningShellState(supportingWorkspaceModelToPlanningShellState(workspace, body.model));
      const nextHeaderData = mergePlanningHeaderData(headerData, normalizePlanningHeaderData(body.headerData));
      setProtectedPlanningShellStateCache({
        authUserId: authUser.id,
        data: nextData,
        headerData: nextHeaderData,
        currentProfile: body.currentProfile || serverCurrentProfile,
      });
      setData(nextData);
      setHeaderData(nextHeaderData);
      setProtectedDataLoaded(true);
      return true;
    }
    if (workspace === "sprint") {
      const { response, body } = await planningApi.requestSprintWorkspaceData(apiClient);
      if (!response.ok || !body?.model) return false;
      const nextData = normalizePlanningShellState(sprintWorkspaceModelToPlanningShellState(body.model));
      const nextHeaderData = mergePlanningHeaderData(headerData, normalizePlanningHeaderData(body.headerData));
      setProtectedPlanningShellStateCache({
        authUserId: authUser.id,
        data: nextData,
        headerData: nextHeaderData,
        currentProfile: body.currentProfile || serverCurrentProfile,
      });
      setData(nextData);
      setHeaderData(nextHeaderData);
      setProtectedDataLoaded(true);
      return true;
    }
    return false;
  }, [apiClient, authUser, headerData, serverCurrentProfile, setData, setHeaderData, setProtectedDataLoaded, source, workspace]);

  const refreshCurrentWorkspaceModel = useCallback(async () => {
    await refreshCurrentWorkspaceModelWithResult();
  }, [refreshCurrentWorkspaceModelWithResult]);

  return { applyPlanningShellStateUpdate, refreshCurrentWorkspaceModel, refreshCurrentWorkspaceModelWithResult };
}
