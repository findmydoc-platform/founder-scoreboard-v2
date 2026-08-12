import type { User } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { getBrowserSupabase } from "@/lib/supabase";
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
  data: PlanningShellState;
  headerData: PlanningHeaderData;
  currentProfile: AuthenticatedProfile | null;
};

let protectedPlanningShellStateCache: ProtectedPlanningShellStateCache | null = null;

export function getProtectedPlanningShellStateCache() {
  return protectedPlanningShellStateCache;
}

export function setProtectedPlanningShellStateCache(cache: ProtectedPlanningShellStateCache | null) {
  protectedPlanningShellStateCache = cache;
}

type UsePlanningAuthOptions = {
  authRequired: boolean;
  source: "supabase";
  safeInitialData: PlanningShellState;
  safeInitialHeaderData: PlanningHeaderData;
  taskCount: number;
  workspace: AppWorkspace;
  initialAuthUser?: User | null;
  initialCurrentProfile?: AuthenticatedProfile | null;
  initialProtectedDataLoaded?: boolean;
  initialAuthError?: string;
  setData: (data: PlanningShellState) => void;
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
  safeInitialData,
  safeInitialHeaderData,
  taskCount,
  workspace,
  initialAuthUser = null,
  initialCurrentProfile = null,
  initialProtectedDataLoaded = false,
  initialAuthError = "",
  setData,
  setHeaderData,
  normalizePlanningShellState,
  normalizePlanningHeaderData,
  onSignedOut,
}: UsePlanningAuthOptions) {
  const protectedDataUserIdRef = useRef(initialProtectedDataLoaded ? initialAuthUser?.id || "" : "");
  const [authUser, setAuthUser] = useState<User | null>(initialAuthUser);
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
    const supabase = getBrowserSupabase();
    if (!supabase) {
      queueMicrotask(() => {
        setGithubConnectionState("unknown");
        setAuthChecked(true);
      });
      return;
    }

    let active = true;

    const refreshGitHubUserConnectionState = async (session: Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]) => {
      if (!active) return;
      if (isLocalLoginSimulationEnabled()) {
        setGithubInstallationAvailable(false);
        setGithubUserConnected(false);
        setWaitingGitHubCommentCount(0);
        setGithubReauthFailed(false);
        setGithubConnectionState("unknown");
        return;
      }
      if (!session?.access_token) {
        setGithubInstallationAvailable(false);
        setGithubUserConnected(false);
        setWaitingGitHubCommentCount(0);
        setGithubReauthFailed(false);
        setGithubConnectionState("unknown");
        return;
      }
      setGithubConnectionState("checking");
      const status = await fetch("/api/github-app/status", {
        headers: { authorization: `Bearer ${session.access_token}` },
      }).then((response) => response.ok ? response.json() : null).catch(() => null) as {
        installation?: { available?: boolean };
        user?: { connected?: boolean; needsReconnect?: boolean };
        waitingCommentCount?: number;
      } | null;
      if (!active) return;
      const connectionState = githubUserConnectionStateFromStatus(status?.user || null);
      setGithubConnectionState(connectionState);
      setGithubInstallationAvailable(Boolean(status?.installation?.available));
      setGithubUserConnected(connectionState === "connected");
      setWaitingGitHubCommentCount(Number(status?.waitingCommentCount || 0));
      setGithubReauthFailed(connectionState === "reconnect_required");
    };

    const applySessionState = (session: Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]) => {
      if (!active) return;
      if (!session?.user) {
        setGithubInstallationAvailable(false);
        setGithubUserConnected(false);
        setWaitingGitHubCommentCount(0);
        setGithubReauthFailed(false);
        setGithubConnectionState("unknown");
      }
      setAuthUser(session?.user || null);
      setAuthChecked(true);
    };

    const refreshSessionState = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const expiresAt = sessionData.session?.expires_at || 0;
      const expiresSoon = expiresAt > 0 && expiresAt - Math.floor(Date.now() / 1000) < 300;
      if (expiresSoon) {
        const refreshed = await supabase.auth.refreshSession();
        applySessionState(refreshed.data.session || sessionData.session);
        await refreshGitHubUserConnectionState(refreshed.data.session || sessionData.session);
        return;
      }
      applySessionState(sessionData.session);
      await refreshGitHubUserConnectionState(sessionData.session);
    };

    refreshSessionState().catch(() => {
      if (!active) return;
      setGithubConnectionState("unknown");
      setAuthChecked(true);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      setAuthUser(session?.user || null);
      setAuthChecked(true);
      refreshGitHubUserConnectionState(session).catch(() => undefined);
      setAuthError("");
      if (event === "SIGNED_IN") setAuthNotice("");
      if (event === "SIGNED_OUT") {
        setGithubReauthFailed(false);
        setGithubInstallationAvailable(false);
        setGithubUserConnected(false);
        setWaitingGitHubCommentCount(0);
        setGithubConnectionState("unknown");
        protectedDataUserIdRef.current = "";
        protectedPlanningShellStateCache = null;
        setServerCurrentProfile(null);
        setData(safeInitialData);
        setHeaderData(safeInitialHeaderData);
        setProtectedDataLoaded(false);
        onSignedOut();
        setAuthNotice("Du bist abgemeldet. Der Zugriff auf die Planungsdaten ist gesperrt.");
      }
    });

    const keepAliveId = window.setInterval(() => {
      refreshSessionState().catch(() => undefined);
    }, 5 * 60 * 1000);
    const refreshWhenVisible = () => {
      if (!document.hidden) refreshSessionState().catch(() => undefined);
    };
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      active = false;
      window.clearInterval(keepAliveId);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      subscription.subscription.unsubscribe();
    };
  }, [onSignedOut, safeInitialData, safeInitialHeaderData, setData, setHeaderData]);

  useEffect(() => {
    if (!authRequired || source !== "supabase" || !authUser) return;
    if (protectedDataLoaded && protectedDataUserIdRef.current === authUser.id) return;

    let active = true;
    const authUserId = authUser.id;

    if (protectedPlanningShellStateCache?.authUserId === authUserId) {
      const cached = protectedPlanningShellStateCache;
      queueMicrotask(() => {
        if (!active) return;
        protectedDataUserIdRef.current = authUserId;
        setServerCurrentProfile(cached.currentProfile);
        setData(cached.data);
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
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      if (!token) {
        setAuthError("Der Teamzugriff ist aktiv, aber die Anmeldung muss erneuert werden. Bitte erneut anmelden.");
        setProtectedDataLoaded(false);
        return;
      }

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
        const response = await fetch(focusedPlanningRoute, {
          headers: { authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null) as {
          model?: PlanningWorkspaceModel | SupportingWorkspaceModel | SprintWorkspaceModel;
          headerData?: PlanningHeaderData;
          currentProfile?: AuthenticatedProfile | null;
          error?: string;
        } | null;
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
          setData(safeInitialData);
          setHeaderData(safeInitialHeaderData);
          setProtectedDataLoaded(false);
          setAuthError(payload?.error || "Planungsdaten konnten nicht geladen werden.");
          return;
        }

        protectedDataUserIdRef.current = authUserId;
        const nextData = normalizePlanningShellState(payloadData);
        const nextHeaderData = normalizePlanningHeaderData(payload.headerData);
        protectedPlanningShellStateCache = { authUserId, data: nextData, headerData: nextHeaderData, currentProfile: payload.currentProfile };
        setServerCurrentProfile(payload.currentProfile);
        setData(nextData);
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
  }, [authRequired, authUser, normalizePlanningShellState, normalizePlanningHeaderData, protectedDataLoaded, safeInitialData, safeInitialHeaderData, setData, setHeaderData, source, taskCount, workspace]);

  const signIn = useCallback(async (options: SignInOptions = {}) => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;

    setAuthBusy(true);
    setAuthError("");
    setAuthNotice("");
    const next = currentRelativeUrl();
    if (isLocalLoginSimulationEnabled()) {
      const response = await fetch("/api/auth/local-login", { method: "POST" }).catch(() => null);
      if (!response?.ok) {
        const payload = await response?.json().catch(() => null) as { error?: string } | null;
        setAuthError(payload?.error || "Lokaler Login konnte nicht erstellt werden.");
        setAuthBusy(false);
        return;
      }
      window.location.reload();
      return;
    }
    if (options.githubReconnect) {
      setGithubReauthFailed(false);
      setGithubConnectionState("checking");
      window.location.assign(`/api/github-app/connect?next=${encodeURIComponent(next)}`);
      setAuthBusy(false);
      return;
    }

    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo,
        scopes: "repo read:user user:email",
      },
    });

    setAuthBusy(false);
    if (error) {
      setAuthError("GitHub-Anmeldung konnte nicht gestartet werden.");
      if (options.githubReconnect) setGithubReauthFailed(true);
      return;
    }
  }, []);

  const signOut = async () => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;

    setAuthBusy(true);
    setAuthError("");
    setAuthNotice("");
    setGithubReauthFailed(false);
    setGithubInstallationAvailable(false);
    setGithubUserConnected(false);
    setWaitingGitHubCommentCount(0);
    setGithubConnectionState("unknown");

    const { error } = await supabase.auth.signOut({ scope: "global" });
    if (error) {
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
    setData(safeInitialData);
    setHeaderData(safeInitialHeaderData);
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
