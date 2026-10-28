"use client";

import type { User } from "@supabase/supabase-js";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { AuthenticatedProfile, PlanningShellState, PlanningHeaderData } from "@/lib/types";
import type { AppWorkspace } from "../model/workspace-routes";
import type { PlanningState } from "../model/planning-state";

type UseCurrentWorkspaceModelRefreshOptions = {
  planningState: PlanningState;
  apiClient: BrowserApiClient;
  authUser: Pick<User, "id"> | null;
  headerData: PlanningHeaderData;
  serverCurrentProfile: AuthenticatedProfile | null;
  setData: Dispatch<SetStateAction<PlanningShellState>>;
  setProtectedDataLoaded: Dispatch<SetStateAction<boolean>>;
  source: "supabase";
  workspace: AppWorkspace;
};

export function useCurrentWorkspaceModelRefresh({ planningState, authUser, setData, setProtectedDataLoaded, source, workspace }: UseCurrentWorkspaceModelRefreshOptions) {
  const applyPlanningShellStateUpdate = useCallback((updater: (current: PlanningShellState) => PlanningShellState) => {
    setData(updater);
  }, [setData]);
  const refreshCurrentWorkspaceModelWithResult = useCallback(async () => {
    if (source !== "supabase" || !authUser?.id) return false;
    const accepted = await planningState.refreshWorkspace(workspace);
    if (accepted) setProtectedDataLoaded(true);
    return accepted;
  }, [planningState, authUser?.id, setProtectedDataLoaded, source, workspace]);
  const refreshCurrentWorkspaceModel = useCallback(async () => { await refreshCurrentWorkspaceModelWithResult(); }, [refreshCurrentWorkspaceModelWithResult]);
  return { applyPlanningShellStateUpdate, refreshCurrentWorkspaceModel, refreshCurrentWorkspaceModelWithResult };
}
