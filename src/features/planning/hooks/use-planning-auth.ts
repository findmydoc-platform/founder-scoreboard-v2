import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import type { User } from "@supabase/supabase-js";
import { flushSync } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createBrowserApiClient } from "@/lib/browser-api-client";
import { createBrowserSessionAdapter } from "@/lib/credentials/browser";
import type { ServerSessionView } from "@/lib/credentials/session-types";
import type { AuthenticatedProfile, PlanningShellState, PlanningHeaderData } from "@/lib/types";
import { githubUserConnectionStateFromStatus, type GitHubUserConnectionState } from "@/features/planning/model/github-app-connection";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import { isLocalLoginSimulationEnabled } from "@/lib/local-development-auth";
import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";
import { planningWorkspaceModelToPlanningShellState } from "@/features/planning-items/model/planning-shell-projection";
import { isSupportingWorkspace, supportingWorkspaceModelToPlanningShellState, type SupportingWorkspaceModel } from "@/features/planning/model/supporting-planning-shell-projection";
import type { SprintWorkspaceModel } from "@/features/sprint/model/sprint-read-model";
import { sprintWorkspaceModelToPlanningShellState } from "@/features/sprint/model/sprint-planning-shell-projection";

type ProtectedPlanningShellStateCache = {
  authUserId: string;
  workspace?: AppWorkspace;
  data: PlanningShellState;
  headerData: PlanningHeaderData;
  currentProfile: AuthenticatedProfile | null;
};

let protectedPlanningShellStateCache: ProtectedPlanningShellStateCache | null = null;
// Logout must clear cached planning data even while a different workspace is mounted.
createBrowserSessionAdapter().subscribe(session => { if (!session) protectedPlanningShellStateCache = null; });

export function getProtectedPlanningShellStateCache() {
  return protectedPlanningShellStateCache;
}

export function setProtectedPlanningShellStateCache(cache: ProtectedPlanningShellStateCache | null) {
  protectedPlanningShellStateCache = cache;
}

type UsePlanningAuthOptions = {
  authRequired: boolean;
  source: "supabase";
  taskCount: number;
  workspace: AppWorkspace;
  initialAuthUser?: User | null;
  initialCurrentProfile?: AuthenticatedProfile | null;
  initialProtectedDataLoaded?: boolean;
  initialAuthError?: string;
  setData: (data: PlanningShellState, account: string) => void;
  clearPlanningState: () => void;
  setHeaderData: (data: PlanningHeaderData) => void;
  normalizePlanningShellState: (data: PlanningShellState) => PlanningShellState;
  normalizePlanningHeaderData: (data?: Partial<PlanningHeaderData> | null) => PlanningHeaderData;
  onSignedOut: () => void;
};

type SignInOptions = {
  githubReconnect?: boolean;
  clearReconnectGuard?: boolean;
};

function currentRelativeUrl() {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash}` || "/";
}

export function usePlanningAuth({
  authRequired,
  source,
  taskCount,
  workspace,
  initialAuthUser = null,
  initialCurrentProfile = null,
  initialProtectedDataLoaded = false,
  initialAuthError = "",
  setData,
  clearPlanningState,
  setHeaderData,
  normalizePlanningShellState,
  normalizePlanningHeaderData,
  onSignedOut,
}: UsePlanningAuthOptions) {
  const apiClient = useMemo(() => createBrowserApiClient(), []);
  const protectedDataUserIdRef = useRef(initialProtectedDataLoaded ? initialAuthUser?.id || "" : "");
  const [authUser, setAuthUser] = useState<ServerSessionView["user"] | null>(initialAuthUser);
  const [authChecked, setAuthChecked] = useState(!authRequired || Boolean(initialAuthUser));
  const [protectedDataLoaded, setProtectedDataLoaded] = useState(!authRequired || initialProtectedDataLoaded);
  const [serverCurrentProfile, setServerCurrentProfile] = useState<AuthenticatedProfile | null>(initialCurrentProfile);
  const [githubConnectionState, setGithubConnectionState] = useState<GitHubUserConnectionState>(authRequired && initialAuthUser ? "checking" : "unknown");
  const [githubInstallationAvailable, setGithubInstallationAvailable] = useState(false);
  const [githubUserConnected, setGithubUserConnected] = useState(false);
  const [waitingGitHubCommentCount, setWaitingGitHubCommentCount] = useState(0);
  const [githubReauthFailed, setGithubReauthFailed] = useState(false);
  const [authError, setAuthError] = useState(initialAuthError);
  const [authNotice, setAuthNotice] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    const sessions = createBrowserSessionAdapter();
    let active = true;
    let generation = 0;

    const refreshGitHubUserConnectionState = async (session: ServerSessionView | null) => {
      if (!active) return;
      const started = generation;
      if (isLocalLoginSimulationEnabled()) {
        setGithubInstallationAvailable(false);
        setGithubUserConnected(false);
        setWaitingGitHubCommentCount(0);
        setGithubReauthFailed(false);
        setGithubConnectionState("unknown");
        return;
      }
      if (!session) {
        setGithubInstallationAvailable(false);
        setGithubUserConnected(false);
        setWaitingGitHubCommentCount(0);
        setGithubReauthFailed(false);
        setGithubConnectionState("unknown");
        return;
      }
      setGithubConnectionState("checking");
      const { response, body } = await apiClient.requestJson<{
        installation?: { available?: boolean };
        user?: { connected?: boolean; needsReconnect?: boolean };
        waitingCommentCount?: number;
      }>("/api/github-app/status").catch(() => ({ response: null, body: null }));
      const status = response?.ok ? body : null;
      if (!active || started !== generation) return;
      const connectionState = githubUserConnectionStateFromStatus(status?.user || null);
      setGithubConnectionState(connectionState);
      setGithubInstallationAvailable(Boolean(status?.installation?.available));
      setGithubUserConnected(connectionState === "connected");
      setWaitingGitHubCommentCount(Number(status?.waitingCommentCount || 0));
      setGithubReauthFailed(connectionState === "reconnect_required");
    };

    const clearProtected = () => {
      clearPlanningState();
      protectedDataUserIdRef.current = "";
      protectedPlanningShellStateCache = null;
      setServerCurrentProfile(null);
      setHeaderData(emptyPlanningHeaderData);
      setProtectedDataLoaded(false);
      onSignedOut();
    };
    let displayedUser = initialAuthUser?.id || "";
    let lastAccount = displayedUser;
    const applySessionState = (session: ServerSessionView | null) => {
      if (!active) return;
      generation++;
      if (lastAccount && session?.userId && lastAccount !== session.userId) {
        flushSync(() => { clearProtected(); setAuthUser(null); });
        window.location.reload(); return;
      }
      if (authRequired && (displayedUser !== (session?.userId || "") || !session)) clearProtected();
      if (session?.userId) lastAccount = session.userId;
      displayedUser = session?.userId || "";
      setAuthUser(session?.user || null);
      setAuthChecked(true);
      setAuthError("");
      if (!session) setAuthNotice("Du bist abgemeldet. Der Zugriff auf die Planungsdaten ist gesperrt.");
      else setAuthNotice("");
      refreshGitHubUserConnectionState(session).catch(() => undefined);
    };
    const unsubscribe = sessions.subscribe(applySessionState);
    sessions.refresh().catch(() => {
      if (active) { setGithubConnectionState("unknown"); setAuthChecked(true); }
    });
    return () => { active = false; unsubscribe(); };

  }, [apiClient, authRequired, initialAuthUser?.id, onSignedOut, setData, clearPlanningState, setHeaderData]);

  useEffect(() => {
    if (!authRequired || source !== "supabase" || !authUser) return;
    if (protectedDataLoaded && protectedDataUserIdRef.current === authUser.id) return;

    let active = true;
    const authUserId = authUser.id;

    if (protectedPlanningShellStateCache?.authUserId === authUserId && protectedPlanningShellStateCache.workspace === workspace) {
      const cached = protectedPlanningShellStateCache;
      queueMicrotask(() => {
        if (!active) return;
        protectedDataUserIdRef.current = authUserId;
        setServerCurrentProfile(cached.currentProfile);
        setData(cached.data, authUserId);
        setHeaderData(cached.headerData);
        setProtectedDataLoaded(true);
        setAuthError("");
      });
      return () => {
        active = false;
      };
    }

    async function loadProtectedPlanningShellState() {
      if (!taskCount) setProtectedDataLoaded(false);
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 10_000);

      try {
        const focusedPlanningRoute = workspace === "planning"
          ? "/api/planning-board-data"
          : workspace === "projects"
            ? "/api/strategic-planning-data"
            : isSupportingWorkspace(workspace)
              ? `/api/${workspace}-data`
              : workspace === "sprint"
                ? "/api/sprint-data"
                : "";
        if (!focusedPlanningRoute) {
          protectedDataUserIdRef.current = authUserId;
          setProtectedDataLoaded(true);
          return;
        }
        const { response, body: payload } = await apiClient.requestJson<{
          model?: PlanningWorkspaceModel | SupportingWorkspaceModel | SprintWorkspaceModel;
          headerData?: PlanningHeaderData;
          currentProfile?: AuthenticatedProfile | null;
          error?: string;
        }>(focusedPlanningRoute, {
          signal: controller.signal,
        });
        const payloadData = payload?.model
          ? workspace === "sprint"
            ? sprintWorkspaceModelToPlanningShellState(payload.model as SprintWorkspaceModel)
            : isSupportingWorkspace(workspace)
              ? supportingWorkspaceModelToPlanningShellState(workspace, payload.model as SupportingWorkspaceModel)
              : planningWorkspaceModelToPlanningShellState(payload.model as PlanningWorkspaceModel)
          : null;

        if (!active) return;
        if (!response.ok || !payloadData || !payload?.currentProfile) {
          protectedDataUserIdRef.current = "";
          setServerCurrentProfile(null);
          clearPlanningState();
          setHeaderData(emptyPlanningHeaderData);
          setProtectedDataLoaded(false);
          setAuthError(payload?.error || "Planungsdaten konnten nicht geladen werden.");
          return;
        }

        protectedDataUserIdRef.current = authUserId;
        const nextData = normalizePlanningShellState(payloadData);
        const nextHeaderData = normalizePlanningHeaderData(payload.headerData);
        protectedPlanningShellStateCache = { authUserId, workspace, data: nextData, headerData: nextHeaderData, currentProfile: payload.currentProfile };
        setServerCurrentProfile(payload.currentProfile);
        setData(nextData, authUserId);
        setHeaderData(nextHeaderData);
        setProtectedDataLoaded(true);
        setAuthError("");
      } catch (error) {
        if (!active) return;
        protectedDataUserIdRef.current = "";
        setServerCurrentProfile(null);
        setProtectedDataLoaded(false);
        setAuthError(error instanceof DOMException && error.name === "AbortError" ? "Planungsdaten konnten nicht geladen werden: Zeitüberschreitung." : "Planungsdaten konnten nicht geladen werden.");
      } finally {
        window.clearTimeout(timeout);
      }
    }

    loadProtectedPlanningShellState();

    return () => {
      active = false;
    };
  }, [apiClient, authRequired, authUser, normalizePlanningShellState, normalizePlanningHeaderData, protectedDataLoaded, setData, clearPlanningState, setHeaderData, source, taskCount, workspace]);

  const signIn = useCallback(async (options: SignInOptions = {}) => {
    setAuthBusy(true);
    setAuthError("");
    setAuthNotice("");
    const next = currentRelativeUrl();
    if (isLocalLoginSimulationEnabled()) {
      const success = await createBrowserSessionAdapter().startLocalLogin();
      if (!success) {
        setAuthError("Lokaler Login konnte nicht erstellt werden.");
        setAuthBusy(false);
        return;
      }
      return;
    }
    if (options.githubReconnect) {
      setGithubReauthFailed(false);
      setGithubConnectionState("checking");
      window.location.assign(`/api/github-app/connect?next=${encodeURIComponent(next)}`);
      setAuthBusy(false);
      return;
    }

    window.location.assign(`/auth/login?next=${encodeURIComponent(next)}`);

  }, []);

  const signOut = async () => {
    setAuthBusy(true);
    setAuthError("");
    setAuthNotice("");
    setGithubReauthFailed(false);
    setGithubInstallationAvailable(false);
    setGithubUserConnected(false);
    setWaitingGitHubCommentCount(0);
    setGithubConnectionState("unknown");

    const success = await createBrowserSessionAdapter().logout();
    if (!success) {
      setAuthError("Abmeldung konnte nicht abgeschlossen werden.");
      setAuthBusy(false);
      return;
    }

    protectedDataUserIdRef.current = "";
    protectedPlanningShellStateCache = null;
    setServerCurrentProfile(null);
    setAuthUser(null);
    setGithubInstallationAvailable(false);
    setGithubUserConnected(false);
    setWaitingGitHubCommentCount(0);
    setGithubConnectionState("unknown");
    clearPlanningState();
    setHeaderData(emptyPlanningHeaderData);
    setProtectedDataLoaded(false);
    onSignedOut();
    setAuthNotice("Du bist abgemeldet. Der Zugriff auf die Planungsdaten ist gesperrt.");
    setAuthBusy(false);
  };

  return {
    authUser,
    serverCurrentProfile,
    authChecked,
    protectedDataLoaded,
    setProtectedDataLoaded,
    githubConnectionState,
    githubInstallationAvailable,
    githubUserConnected,
    waitingGitHubCommentCount,
    githubReauthFailed,
    authError,
    authNotice,
    authBusy,
    signIn,
    signOut,
  };
}
