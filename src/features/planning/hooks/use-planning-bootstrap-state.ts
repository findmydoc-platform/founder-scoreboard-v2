"use client";

import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { usePlanningStateOwner } from "./use-planning-state-owner";
import { usePlanningAuth } from "@/features/planning/hooks/use-planning-auth";
import { useCurrentWorkspaceModelRefresh } from "@/features/planning/hooks/use-workspace-model-refresh";
import { usePlanningFocusMode } from "@/features/planning/hooks/use-planning-focus-mode";
import { usePlanningRemoteChanges } from "@/features/planning/hooks/use-planning-remote-changes";
import { usePlanningRequestContext } from "@/features/planning/hooks/use-planning-request-context";
import { usePlanningViewState } from "@/features/planning/hooks/use-planning-view-state";
import { usePlanningWorkspace } from "@/features/planning/hooks/use-planning-workspace";
import { normalizePlanningShellState } from "@/features/planning/model/planning-app-model";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import { normalizePlanningHeaderData } from "@/lib/planning-header-data";
import { taskBelongsToProfile } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import type { AuthenticatedProfile, PlanningShellState, PlanningHeaderData, Task } from "@/lib/types";

export type PlanningBootstrapStateOptions = {
  initialServerHeaderRead?: import("../model/planning-server-header-read").PlanningServerHeaderRead;
  initialWorkspaceRead?: import("../model/planning-workspace-hydration").PlanningWorkspaceHydration;
  initialDecisionLogResult?: import("@/lib/notion-decision-log").NotionDecisionLogResult;
  initialData: PlanningShellState;
  initialHeaderData: PlanningHeaderData;
  initialWorkspace: AppWorkspace;
  source: "supabase";
  authRequired: boolean;
  initialAuthUser?: User | null;
  initialCurrentProfile?: AuthenticatedProfile | null;
  initialProtectedDataLoaded?: boolean;
  initialAuthError?: string;
  operationalCorrection?: boolean;
  administratorAccess?: import("@/features/administrator-access/model/administrator-access").AdministratorAccessSnapshot;
};

export function usePlanningBootstrapState({
  initialWorkspaceRead,
  initialServerHeaderRead,
  initialDecisionLogResult,
  initialData,
  initialHeaderData,
  initialWorkspace,
  source,
  authRequired,
  initialAuthUser = null,
  initialCurrentProfile = null,
  initialProtectedDataLoaded = false,
  initialAuthError = "",
  operationalCorrection = false,
  administratorAccess,
}: PlanningBootstrapStateOptions) {
  const safeInitialData = useMemo(() => normalizePlanningShellState(initialData), [initialData]);
  const safeInitialHeaderData = useMemo(() => normalizePlanningHeaderData(initialHeaderData), [initialHeaderData]);
  const initialClientData = useMemo(() => safeInitialData, [safeInitialData]);
  const stateOwner = usePlanningStateOwner({ initialServerHeaderRead, initialWorkspaceRead, initialDecisionLogResult, initialData: initialClientData, initialHeaderData: safeInitialHeaderData, initialCurrentProfile, initialUserId: initialAuthUser?.id || "", initialWorkspace, initialAdministratorAccess: administratorAccess });
  const { data, planningState } = stateOwner;
  const { workspace, setWorkspace, navigateWorkspaceHref } = usePlanningWorkspace(initialWorkspace, planningState);
  const viewState = usePlanningViewState({
    initialData: safeInitialData,
    initialQuery: initialWorkspaceRead?.query || initialWorkspaceRead?.board?.query,
    initialView: safeInitialData.profileUiPreferences.find(item => item.profileId === initialCurrentProfile?.id)?.defaultTaskView,
  });
  const { setSelectedTaskId } = viewState;
  const [isPending, startTransition] = useTransition();
  const [saveError, setSaveError] = useState("");
  const [statusGuardNotice, setStatusGuardNotice] = useState("");
  const [statusGuardTaskId, setStatusGuardTaskId] = useState<string | null>(null);
  const [githubSyncQueueOpen, setGithubSyncQueueOpen] = useState(false);

  const clearSelectedTask = useCallback(() => setSelectedTaskId(null), [setSelectedTaskId]);
  const githubConnection=planningState.githubConnection();
  const auth = usePlanningAuth({
    loadGitHubConnection:planningState.loadGitHubConnection,
    authRequired,
    source,
    taskCount: data.tasks.length,
    workspace,
    initialAuthUser,
    initialCurrentProfile,
    initialProtectedDataLoaded,
    initialAuthError,
    planningState,
    clearPlanningState: stateOwner.clearPlanningState,
    onSignedOut: clearSelectedTask,
  });

  const authAvailable = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const currentGithubLogin = String(auth.authUser?.githubLogin || "");
  const requestContext = usePlanningRequestContext({
    source,
    profiles: data.profiles,
    currentGithubLogin,
    currentProfileId: auth.serverCurrentProfile?.id || "",
  });
  useEffect(() => {
    stateOwner.configure(requestContext.apiClient, workspace, auth.serverCurrentProfile, administratorAccess);
  }, [stateOwner, requestContext.apiClient, workspace, auth.serverCurrentProfile, administratorAccess]);
  const currentProfileId = requestContext.currentProfile?.id || "";
  const headerData = planningState.header().data;
  const canManageTaskMeta = requestContext.currentProfile?.platformRole === "ceo" || requestContext.currentProfile?.platformRole === "deputy";
  const canCorrectOperationally = operationalCorrection;
  const canManageFinalTaskStatus = requestContext.currentProfile?.platformRole === "ceo";
  const canChangeTaskStatus = useCallback((task: Task) => (
    task.reviewStatus !== "requested"
    &&
    (normalizeStatus(task.status) !== "Erledigt" || canManageFinalTaskStatus)
    && (canManageTaskMeta || canCorrectOperationally || taskBelongsToProfile(task, requestContext.currentProfile))
  ), [canCorrectOperationally, canManageFinalTaskStatus, canManageTaskMeta, requestContext.currentProfile]);
  const dataRefresh = useCurrentWorkspaceModelRefresh({
    planningState,
    authUser: auth.authUser,
    setProtectedDataLoaded: auth.setProtectedDataLoaded,
    source,
    workspace,
  });
  const focusMode = usePlanningFocusMode();
  const remoteChanges = usePlanningRemoteChanges({
    planningState,
    enabled: source === "supabase" && auth.protectedDataLoaded && workspace === "planning",
    refreshCurrentWorkspaceModel: dataRefresh.refreshCurrentWorkspaceModel,
    scopeRevision: planningState.board().scopeRevision,
    authoritativeRevision: planningState.board().result?.workspaceRevision,
  });

  return {
    ...auth,
    githubConnectionState:githubConnection.readStatus==="loading"?"checking" as const:githubConnection.state,
    githubInstallationAvailable:githubConnection.installationAvailable,
    githubUserConnected:githubConnection.userConnected,
    waitingGitHubCommentCount:githubConnection.waitingCommentCount,
    githubReauthFailed:githubConnection.state==="reconnect_required",
    ...dataRefresh,
    ...focusMode,
    ...remoteChanges,
    ...requestContext,
    ...viewState,
    planningState,
    authAvailable,
    canChangeTaskStatus,
    canCorrectOperationally,
    canManageFinalTaskStatus,
    canManageTaskMeta,
    currentProfileId,
    data,
    headerData,
    githubSyncQueueOpen,
    isPending,
    saveError,
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
    navigateWorkspaceHref,
  };
}
