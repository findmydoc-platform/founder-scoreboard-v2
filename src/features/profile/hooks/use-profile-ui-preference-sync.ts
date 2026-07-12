"use client";

import { useEffect, useMemo, useRef, type Dispatch, type SetStateAction } from "react";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { PlanningData, PlanningFilterPreferences, ProfileUiPreference, ViewMode } from "@/lib/types";
import { appWorkspaceFromValue, workspaceFromPathname, type AppWorkspace } from "@/features/planning/model/workspace-routes";
import { planningWorkspaces } from "@/features/planning/model/planning-app-model";
import * as planningApi from "@/features/planning/model/planning-api-client";

type ProfileUiPreferenceSyncOptions = {
  apiClient: BrowserApiClient;
  currentProfileId: string;
  data: PlanningData;
  expandedPackages: Record<string, boolean>;
  filters: PlanningFilterPreferences;
  protectedDataLoaded: boolean;
  setData: Dispatch<SetStateAction<PlanningData>>;
  setExpandedPackageIds: (packageIds: string[]) => void;
  setFilters: (filters: PlanningFilterPreferences) => void;
  setView: (view: ViewMode) => void;
  setWorkspace: (workspace: AppWorkspace) => void;
  source: "seed" | "supabase";
  view: ViewMode;
  workspace: AppWorkspace;
};

function pathHasWorkspace() {
  if (typeof window === "undefined") return true;
  return Boolean(workspaceFromPathname(window.location.pathname));
}

function expandedPackageIds(expandedPackages: Record<string, boolean>) {
  return Object.entries(expandedPackages)
    .filter(([, expanded]) => expanded)
    .map(([packageId]) => packageId);
}

function normalizedDefaultWorkspace(value: string) {
  return appWorkspaceFromValue(value) || "planning";
}

function upsertUiPreference(
  data: PlanningData,
  profileId: string,
  preference: ProfileUiPreference,
) {
  return {
    ...data,
    profileUiPreferences: data.profileUiPreferences.some((item) => item.profileId === profileId)
      ? data.profileUiPreferences.map((item) => (item.profileId === profileId ? preference : item))
      : [preference, ...data.profileUiPreferences],
  };
}

export function useProfileUiPreferenceSync({
  apiClient,
  currentProfileId,
  data,
  expandedPackages,
  filters,
  protectedDataLoaded,
  setData,
  setExpandedPackageIds,
  setFilters,
  setView,
  setWorkspace,
  source,
  view,
  workspace,
}: ProfileUiPreferenceSyncOptions) {
  const preference = useMemo(
    () => data.profileUiPreferences.find((item) => item.profileId === currentProfileId) || null,
    [currentProfileId, data.profileUiPreferences],
  );
  const hydratedProfileRef = useRef("");
  const persistenceDisabledRef = useRef(false);

  useEffect(() => {
    if (!currentProfileId || hydratedProfileRef.current === currentProfileId) return;
    hydratedProfileRef.current = currentProfileId;
    if (!preference) return;

    setView(preference.defaultTaskView);
    setFilters({
      ...preference.planningFilters,
      assignee: preference.defaultWorkspace === "mine" ? "Alle" : preference.planningFilters.assignee,
      quick: preference.defaultWorkspace === "mine"
        ? Array.from(new Set(["mine", ...preference.planningFilters.quick]))
        : preference.planningFilters.quick,
    });
    setExpandedPackageIds(preference.expandedPackageIds);
    if (!pathHasWorkspace() && preference.defaultWorkspace !== "profile") {
      setWorkspace(normalizedDefaultWorkspace(preference.defaultWorkspace));
    }
  }, [currentProfileId, preference, setExpandedPackageIds, setFilters, setView, setWorkspace]);

  useEffect(() => {
    if (
      !currentProfileId
      || source !== "supabase"
      || !protectedDataLoaded
      || persistenceDisabledRef.current
      || hydratedProfileRef.current !== currentProfileId
      || !planningWorkspaces.includes(workspace)
    ) {
      return;
    }

    const timeout = window.setTimeout(async () => {
      const { response, body } = await planningApi.updateOwnProfileSettingsRequest(apiClient, {
        uiPreferences: {
          defaultWorkspace: preference?.defaultWorkspace || "planning",
          defaultTaskView: view,
          planningFilters: filters,
          expandedPackageIds: expandedPackageIds(expandedPackages),
        },
      });
      if (response.status === 503) {
        persistenceDisabledRef.current = true;
        return;
      }
      if (response.ok && body?.uiPreference) {
        setData((current) => upsertUiPreference(current, currentProfileId, body.uiPreference!));
      }
    }, 900);

    return () => window.clearTimeout(timeout);
  }, [
    apiClient,
    currentProfileId,
    expandedPackages,
    filters,
    preference?.defaultWorkspace,
    protectedDataLoaded,
    setData,
    source,
    view,
    workspace,
  ]);
}
