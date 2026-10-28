"use client";

import type { User } from "@supabase/supabase-js";
import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { AppWorkspace } from "../model/workspace-routes";
import type { PlanningState } from "../model/planning-state";

type UseCurrentWorkspaceModelRefreshOptions = {
  planningState: PlanningState;
  authUser: Pick<User, "id"> | null;
  setProtectedDataLoaded: Dispatch<SetStateAction<boolean>>;
  source: "supabase";
  workspace: AppWorkspace;
};

export function useCurrentWorkspaceModelRefresh({ planningState, authUser, setProtectedDataLoaded, source, workspace }: UseCurrentWorkspaceModelRefreshOptions) {
  const refreshCurrentWorkspaceModelWithResult = useCallback(async () => {
    if (source !== "supabase" || !authUser?.id) return false;
    const accepted = await planningState.refreshWorkspace(workspace);
    if (accepted) setProtectedDataLoaded(true);
    return accepted;
  }, [planningState, authUser?.id, setProtectedDataLoaded, source, workspace]);
  const refreshCurrentWorkspaceModel = useCallback(async () => { await refreshCurrentWorkspaceModelWithResult(); }, [refreshCurrentWorkspaceModelWithResult]);
  return { refreshCurrentWorkspaceModel, refreshCurrentWorkspaceModelWithResult };
}
