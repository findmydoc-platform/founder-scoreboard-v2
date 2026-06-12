import type { User } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { clearRememberedGitHubProviderToken, hasRememberedGitHubProviderToken, rememberGitHubProviderToken } from "@/lib/github-provider-token";
import { getBrowserSupabase } from "@/lib/supabase";
import type { PlanningData } from "@/lib/types";

let protectedPlanningDataCache: PlanningData | null = null;

export function getProtectedPlanningDataCache() {
  return protectedPlanningDataCache;
}

export function setProtectedPlanningDataCache(data: PlanningData | null) {
  protectedPlanningDataCache = data;
}

type UsePlanningAuthOptions = {
  authRequired: boolean;
  source: "seed" | "supabase";
  safeInitialData: PlanningData;
  taskCount: number;
  setData: (data: PlanningData) => void;
  normalizePlanningData: (data: PlanningData) => PlanningData;
  onSignedOut: () => void;
};

export function usePlanningAuth({
  authRequired,
  source,
  safeInitialData,
  taskCount,
  setData,
  normalizePlanningData,
  onSignedOut,
}: UsePlanningAuthOptions) {
  const protectedDataUserIdRef = useRef("");
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(!authRequired);
  const [protectedDataLoaded, setProtectedDataLoaded] = useState(!authRequired || (source === "supabase" && Boolean(protectedPlanningDataCache)));
  const [githubProviderTokenAvailable, setGithubProviderTokenAvailable] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) {
      queueMicrotask(() => setAuthChecked(true));
      return;
    }

    let active = true;

    const applySessionState = (session: Awaited<ReturnType<typeof supabase.auth.getSession>>["data"]["session"]) => {
      if (!active) return;
      rememberGitHubProviderToken(session?.provider_token);
      setAuthUser(session?.user || null);
      setGithubProviderTokenAvailable(hasRememberedGitHubProviderToken());
      setAuthChecked(true);
    };

    const refreshSessionState = async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const expiresAt = sessionData.session?.expires_at || 0;
      const expiresSoon = expiresAt > 0 && expiresAt - Math.floor(Date.now() / 1000) < 300;
      if (expiresSoon) {
        const refreshed = await supabase.auth.refreshSession();
        applySessionState(refreshed.data.session || sessionData.session);
        return;
      }
      applySessionState(sessionData.session);
    };

    refreshSessionState().catch(() => {
      if (!active) return;
      setAuthChecked(true);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      rememberGitHubProviderToken(session?.provider_token);
      setAuthUser(session?.user || null);
      setGithubProviderTokenAvailable(hasRememberedGitHubProviderToken());
      setAuthChecked(true);
      setAuthError("");
      if (event === "SIGNED_IN") setAuthNotice("");
      if (event === "SIGNED_OUT") {
        clearRememberedGitHubProviderToken();
        setGithubProviderTokenAvailable(false);
        protectedDataUserIdRef.current = "";
        protectedPlanningDataCache = null;
        setData(safeInitialData);
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
  }, [onSignedOut, safeInitialData, setData]);

  useEffect(() => {
    if (!authRequired || source !== "supabase" || !authUser) return;
    if (protectedDataLoaded && protectedDataUserIdRef.current === authUser.id) return;

    let active = true;
    const authUserId = authUser.id;

    async function loadProtectedPlanningData() {
      if (!taskCount) setProtectedDataLoaded(false);
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      if (!token) {
        setAuthError("Session ist aktiv, aber kein Zugriffstoken verfügbar. Bitte erneut anmelden.");
        setProtectedDataLoaded(false);
        return;
      }

      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 10_000);

      try {
        const response = await fetch("/api/planning-data", {
          headers: { authorization: `Bearer ${token}` },
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null) as { data?: PlanningData; error?: string } | null;

        if (!active) return;
        if (!response.ok || !payload?.data) {
          protectedDataUserIdRef.current = "";
          setData(safeInitialData);
          setProtectedDataLoaded(false);
          setAuthError(payload?.error || "Planungsdaten konnten nicht geladen werden.");
          return;
        }

        protectedDataUserIdRef.current = authUserId;
        const nextData = normalizePlanningData(payload.data);
        protectedPlanningDataCache = nextData;
        setData(nextData);
        setProtectedDataLoaded(true);
        setAuthError("");
      } catch (error) {
        if (!active) return;
        protectedDataUserIdRef.current = "";
        setProtectedDataLoaded(false);
        setAuthError(error instanceof DOMException && error.name === "AbortError" ? "Planungsdaten konnten nicht geladen werden: Zeitüberschreitung." : "Planungsdaten konnten nicht geladen werden.");
      } finally {
        window.clearTimeout(timeout);
      }
    }

    loadProtectedPlanningData();

    return () => {
      active = false;
    };
  }, [authRequired, authUser, normalizePlanningData, protectedDataLoaded, safeInitialData, setData, source, taskCount]);

  const signIn = async () => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;

    setAuthBusy(true);
    setAuthError("");
    setAuthNotice("");

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: window.location.origin,
        scopes: "repo read:user user:email",
      },
    });

    setAuthBusy(false);
    if (error) {
      setAuthError("GitHub-Anmeldung konnte nicht gestartet werden.");
      return;
    }
  };

  const signOut = async () => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;

    setAuthBusy(true);
    setAuthError("");
    setAuthNotice("");
    clearRememberedGitHubProviderToken();
    setGithubProviderTokenAvailable(false);

    const { error } = await supabase.auth.signOut({ scope: "global" });
    if (error) {
      setAuthError("Abmeldung konnte nicht abgeschlossen werden.");
      setAuthBusy(false);
      return;
    }

    protectedDataUserIdRef.current = "";
    protectedPlanningDataCache = null;
    setAuthUser(null);
    setGithubProviderTokenAvailable(false);
    setData(safeInitialData);
    setProtectedDataLoaded(false);
    onSignedOut();
    setAuthNotice("Du bist abgemeldet. Der Zugriff auf die Planungsdaten ist gesperrt.");
    setAuthBusy(false);
  };

  return {
    authUser,
    authChecked,
    protectedDataLoaded,
    setProtectedDataLoaded,
    githubProviderTokenAvailable,
    authError,
    authNotice,
    authBusy,
    signIn,
    signOut,
  };
}
