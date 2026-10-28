import type { User } from "@supabase/supabase-js";
import { flushSync } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import { createBrowserSessionAdapter } from "@/lib/credentials/browser";
import type { ServerSessionView } from "@/lib/credentials/session-types";
import type { AuthenticatedProfile } from "@/lib/types";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import { isLocalLoginSimulationEnabled } from "@/lib/local-development-auth";
import type { PlanningState } from "../model/planning-state";

type UsePlanningAuthOptions = {
  loadGitHubConnection: () => Promise<boolean>;
  authRequired: boolean;
  source: "supabase";
  taskCount: number;
  workspace: AppWorkspace;
  initialAuthUser?: User | null;
  initialCurrentProfile?: AuthenticatedProfile | null;
  initialProtectedDataLoaded?: boolean;
  initialAuthError?: string;
  planningState: PlanningState;
  clearPlanningState: () => void;
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
  loadGitHubConnection,
  authRequired,
  source,
  taskCount,
  workspace,
  initialAuthUser = null,
  initialProtectedDataLoaded = false,
  initialAuthError = "",
  planningState,
  clearPlanningState,
  onSignedOut,
}: UsePlanningAuthOptions) {
  const protectedDataUserIdRef = useRef(initialProtectedDataLoaded ? initialAuthUser?.id || "" : "");
  const [authUser, setAuthUser] = useState<ServerSessionView["user"] | null>(initialAuthUser);
  const [authChecked, setAuthChecked] = useState(!authRequired || Boolean(initialAuthUser));
  const [protectedDataLoaded, setProtectedDataLoaded] = useState(!authRequired || initialProtectedDataLoaded);
  const serverCurrentProfile = planningState.currentProfile();
  const [authError, setAuthError] = useState(initialAuthError);
  const [authNotice, setAuthNotice] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    const sessions = createBrowserSessionAdapter();
    let active = true;

    const clearProtected = () => {
      clearPlanningState();
      protectedDataUserIdRef.current = "";

      setProtectedDataLoaded(false);
      onSignedOut();
    };
    let displayedUser = initialAuthUser?.id || "";
    let lastAccount = displayedUser;
    const applySessionState = (session: ServerSessionView | null) => {
      if (!active) return;
      if (lastAccount && session?.userId && lastAccount !== session.userId) {
        flushSync(() => { clearProtected(); setAuthUser(null); });
        window.location.reload(); return;
      }
      if (authRequired && (displayedUser !== (session?.userId || "") || !session)) clearProtected();
      if (session?.userId) lastAccount = session.userId;
      displayedUser = session?.userId || "";
      setAuthUser(current => {
        const next=session?.user || null;
        return current && next && current.id === next.id && current.email === next.email && current.githubLogin === next.githubLogin && current.displayName === next.displayName && current.avatarUrl === next.avatarUrl ? current : next;
      });
      setAuthChecked(true);
      setAuthError("");
      if (!session) setAuthNotice("Du bist abgemeldet. Der Zugriff auf die Planungsdaten ist gesperrt.");
      else setAuthNotice("");
      if (session && !isLocalLoginSimulationEnabled()) void loadGitHubConnection();
    };
    const unsubscribe = sessions.subscribe(applySessionState);
    sessions.refresh().catch(() => {
      if (active) setAuthChecked(true);
    });
    return () => { active = false; unsubscribe(); };

  }, [authRequired, initialAuthUser?.id, onSignedOut, planningState, clearPlanningState, loadGitHubConnection]);

  useEffect(() => {
    if (!authRequired || source !== "supabase" || !authUser) return;
    if (protectedDataLoaded && protectedDataUserIdRef.current === authUser.id) return;

    let active = true;
    const authUserId = authUser.id;

    async function loadProtectedPlanningShellState() {
      if (!taskCount) setProtectedDataLoaded(false);
      try {
        const accepted = await planningState.refreshWorkspace(workspace);
        if (!active) return;
        const profile = planningState.currentProfile();
        if (!accepted || !profile) {
          protectedDataUserIdRef.current = "";
          setProtectedDataLoaded(false);
          setAuthError("Planungsdaten konnten nicht geladen werden.");
          return;
        }
        protectedDataUserIdRef.current = authUserId;
        setProtectedDataLoaded(true);
        setAuthError("");
      } catch (error) {
        if (!active) return;
        protectedDataUserIdRef.current = "";
        setProtectedDataLoaded(false);
        setAuthError(error instanceof Error ? error.message : "Planungsdaten konnten nicht geladen werden.");
      }
    }

    loadProtectedPlanningShellState();

    return () => {
      active = false;
    };
  }, [authRequired, authUser, protectedDataLoaded, planningState, clearPlanningState, source, taskCount, workspace]);

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

    const success = await createBrowserSessionAdapter().logout();
    if (!success) {
      setAuthError("Abmeldung konnte nicht abgeschlossen werden.");
      setAuthBusy(false);
      return;
    }

    protectedDataUserIdRef.current = "";
    setAuthUser(null);
    clearPlanningState();

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
    authError,
    authNotice,
    authBusy,
    signIn,
    signOut,
  };
}
