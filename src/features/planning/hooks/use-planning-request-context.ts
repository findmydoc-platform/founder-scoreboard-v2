import { useCallback, useEffect, useState } from "react";
import { getRememberedGitHubProviderToken } from "@/lib/github-provider-token";
import type { Profile } from "@/lib/types";

const devProfileStateKey = "fmd-planning-dev-profile-v1";

function isLocalDevHost() {
  if (typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}

type RequestHeaderOptions = {
  json?: boolean;
  github?: boolean;
};

type UsePlanningRequestContextOptions = {
  source: "seed" | "supabase";
  profiles: Profile[];
  currentGithubLogin: string;
  currentProfileId?: string;
};

export function usePlanningRequestContext({ source, profiles, currentGithubLogin, currentProfileId = "" }: UsePlanningRequestContextOptions) {
  const [devProfileId, setDevProfileId] = useState("");
  const actualProfile = profiles.find((profile) => profile.id === currentProfileId)
    || profiles.find((profile) => profile.githubLogin === currentGithubLogin)
    || null;
  const devRoleSwitchAvailable = source === "supabase"
    && process.env.NODE_ENV !== "production"
    && isLocalDevHost()
    && (actualProfile?.platformRole === "ceo" || actualProfile?.platformRole === "deputy");
  const devProfile = devRoleSwitchAvailable && devProfileId ? profiles.find((profile) => profile.id === devProfileId) || null : null;
  const currentProfile = devProfile || actualProfile;

  useEffect(() => {
    const storedDevProfile = window.localStorage.getItem(devProfileStateKey) || "";
    if (storedDevProfile) window.queueMicrotask(() => setDevProfileId(storedDevProfile));
  }, []);

  useEffect(() => {
    if (!devRoleSwitchAvailable && devProfileId) {
      window.queueMicrotask(() => setDevProfileId(""));
      window.localStorage.removeItem(devProfileStateKey);
      return;
    }
    if (!devRoleSwitchAvailable) return;
    if (devProfileId) window.localStorage.setItem(devProfileStateKey, devProfileId);
    else window.localStorage.removeItem(devProfileStateKey);
  }, [devProfileId, devRoleSwitchAvailable]);

  const requestHeaders = useCallback((token?: string, options: RequestHeaderOptions = { json: true }) => {
    const githubProviderToken = options.github ? getRememberedGitHubProviderToken() : "";
    return {
      ...(options.json !== false ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(devRoleSwitchAvailable && devProfileId ? { "x-fmd-dev-profile-id": devProfileId } : {}),
      ...(githubProviderToken ? { "x-github-provider-token": githubProviderToken } : {}),
    };
  }, [devProfileId, devRoleSwitchAvailable]);

  return {
    actualProfile,
    currentProfile,
    devProfileId,
    setDevProfileId,
    devRoleSwitchAvailable,
    requestHeaders,
  };
}
