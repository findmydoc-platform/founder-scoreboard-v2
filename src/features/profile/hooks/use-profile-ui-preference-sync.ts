"use client";

import { useEffect, useMemo, useRef } from "react";
import type { PlanningData, PlanningFilterPreferences, ViewMode } from "@/lib/types";
import { appWorkspaceFromValue, workspaceFromPathname, type AppWorkspace } from "@/features/planning/model/workspace-routes";

type ProfileUiPreferenceSyncOptions = {
  currentProfileId: string;
  data: PlanningData;
  hasPlanningFilterUrlState: boolean;
  setExpandedPackageIds: (packageIds: string[]) => void;
  setFilters: (filters: PlanningFilterPreferences) => void;
  setView: (view: ViewMode) => void;
  setWorkspace: (workspace: AppWorkspace) => void;
};

function pathHasWorkspace() {
  if (typeof window === "undefined") return true;
  return Boolean(workspaceFromPathname(window.location.pathname));
}

function normalizedDefaultWorkspace(value: string) {
  return appWorkspaceFromValue(value) || "planning";
}

export function useProfileUiPreferenceSync({
  currentProfileId,
  data,
  hasPlanningFilterUrlState,
  setExpandedPackageIds,
  setFilters,
  setView,
  setWorkspace,
}: ProfileUiPreferenceSyncOptions) {
  const preference = useMemo(
    () => data.profileUiPreferences.find((item) => item.profileId === currentProfileId) || null,
    [currentProfileId, data.profileUiPreferences],
  );
  const hydratedProfileRef = useRef("");

  useEffect(() => {
    if (!currentProfileId || hydratedProfileRef.current === currentProfileId) return;
    hydratedProfileRef.current = currentProfileId;
    if (!preference) return;

    setView(preference.defaultTaskView);
    if (!hasPlanningFilterUrlState) {
      setFilters({
        ...preference.planningFilters,
        assignee: preference.defaultWorkspace === "mine" ? "Alle" : preference.planningFilters.assignee,
        quick: preference.defaultWorkspace === "mine"
          ? Array.from(new Set(["mine", ...preference.planningFilters.quick]))
          : preference.planningFilters.quick,
      });
    }
    setExpandedPackageIds(preference.expandedPackageIds);
    if (!pathHasWorkspace() && preference.defaultWorkspace !== "profile") {
      setWorkspace(normalizedDefaultWorkspace(preference.defaultWorkspace));
    }
  }, [currentProfileId, hasPlanningFilterUrlState, preference, setExpandedPackageIds, setFilters, setView, setWorkspace]);
}
