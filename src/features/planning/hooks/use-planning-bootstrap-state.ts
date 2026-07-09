"use client";

import type { User } from "@supabase/supabase-js";
import { useSearchParams } from "next/navigation";
import { useCallback, useMemo, useState, useTransition } from "react";
import { useLocalPlanningState } from "@/features/planning/hooks/use-local-planning-state";
import { usePlanningAuth } from "@/features/planning/hooks/use-planning-auth";
import { usePlanningDataRefresh } from "@/features/planning/hooks/use-planning-data-refresh";
import { usePlanningRequestContext } from "@/features/planning/hooks/use-planning-request-context";
import { usePlanningViewState } from "@/features/planning/hooks/use-planning-view-state";
import { usePlanningWorkspace } from "@/features/planning/hooks/use-planning-workspace";
import { normalizePlanningData } from "@/features/planning/model/planning-app-model";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import { taskBelongsToProfile } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import { hasSupabaseEnv } from "@/lib/supabase";
import type { AuthenticatedProfile, PlanningData, Task } from "@/lib/types";

export type PlanningBootstrapStateOptions = {
  initialData: PlanningData;
  initialWorkspace: AppWorkspace;
  source: "seed" | "supabase";
  authRequired: boolean;
  demoSeedImportAvailable?: boolean;
  initialAuthUser?: User | null;
  initialCurrentProfile?: AuthenticatedProfile | null;
  initialProtectedDataLoaded?: boolean;
  initialAuthError?: string;
  initialReviewTaskId?: string;
};

export function usePlanningBootstrapState({
  initialData,
  initialWorkspace,
  source,
  authRequired,
  initialAuthUser = null,
  initialCurrentProfile = null,
  initialProtectedDataLoaded = false,
  initialAuthError = "",
  initialReviewTaskId = "",
}: PlanningBootstrapStateOptions) {
  const searchParams = useSearchParams();
  const safeInitialData = useMemo(() => normalizePlanningData(initialData), [initialData]);
  const initialClientData = useMemo(() => safeInitialData, [safeInitialData]);
  const [data, setData] = useState(initialClientData);
  const { localStateLoaded } = useLocalPlanningState({ source, setData });
  const { legacyMineWorkspace, workspace, setWorkspace } = usePlanningWorkspace(initialWorkspace);
  const viewState = usePlanningViewState({
    initialData: safeInitialData,
    initialFocusedReviewTaskId: searchParams.get("reviewTask") || "",
    initialReviewTaskId,
  });
  const { setSelectedTaskId } = viewState;
  const [isPending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState("");
  const [statusGuardNotice, setStatusGuardNotice] = useState("");
  const [statusGuardTaskId, setStatusGuardTaskId] = useState<string | null>(null);
  const [githubSyncQueueOpen, setGithubSyncQueueOpen] = useState(false);

  const clearSelectedTask = useCallback(() => setSelectedTaskId(null), [setSelectedTaskId]);
  const auth = usePlanningAuth({
    authRequired,
    source,
    safeInitialData,
    taskCount: data.tasks.length,
    workspace,
    initialAuthUser,
    initialCurrentProfile,
    initialProtectedDataLoaded,
    initialAuthError,
    setData,
    normalizePlanningData,
    onSignedOut: clearSelectedTask,
  });

  const authAvailable = hasSupabaseEnv();
  const currentGithubLogin = String(auth.authUser?.user_metadata?.user_name || auth.authUser?.user_metadata?.preferred_username || "");
  const requestContext = usePlanningRequestContext({
    source,
    profiles: data.profiles,
    currentGithubLogin,
    currentProfileId: auth.serverCurrentProfile?.id || "",
  });
  const currentProfileId = requestContext.currentProfile?.id || "";
  const canUseCeoIntake = requestContext.currentProfile?.platformRole === "ceo";
  const canManageTaskMeta = source === "seed" || requestContext.currentProfile?.platformRole === "ceo" || requestContext.currentProfile?.platformRole === "deputy";
  const canManageFinalTaskStatus = source === "seed" || requestContext.currentProfile?.platformRole === "ceo";
  const canChangeTaskStatus = useCallback((task: Task) => (
    (normalizeStatus(task.status) !== "Erledigt" || canManageFinalTaskStatus)
    && (canManageTaskMeta || taskBelongsToProfile(task, requestContext.currentProfile))
  ), [canManageFinalTaskStatus, canManageTaskMeta, requestContext.currentProfile]);
  const dataRefresh = usePlanningDataRefresh({
    apiClient: requestContext.apiClient,
    authUser: auth.authUser,
    serverCurrentProfile: auth.serverCurrentProfile,
    setData,
    setProtectedDataLoaded: auth.setProtectedDataLoaded,
    source,
    workspace,
  });

  return {
    ...auth,
    ...dataRefresh,
    ...requestContext,
    ...viewState,
    authAvailable,
    canChangeTaskStatus,
    canManageFinalTaskStatus,
    canManageTaskMeta,
    canUseCeoIntake,
    currentProfileId,
    data,
    githubSyncQueueOpen,
    isPending,
    legacyMineWorkspace,
    localStateLoaded,
    saveError,
    setData,
    setGithubSyncQueueOpen,
    setSaveError,
    setStatusGuardNotice,
    setStatusGuardTaskId,
    setWorkspace,
    source,
    startTransition,
    statusGuardNotice,
    statusGuardTaskId,
    workspace,
  };
}
