"use client";

import { useEffect, useMemo, useRef } from "react";
import type { PlanningShellState, PlanningFilterPreferences, ViewMode } from "@/lib/types";

type ProfileUiPreferenceSyncOptions = {
  currentProfileId: string;
  data: PlanningShellState;
  hasPlanningBoardUrlState: boolean;
  hasPlanningFilterUrlState: boolean;
  setExpandedPackageIds: (packageIds: string[]) => void;
  setFilters: (filters: PlanningFilterPreferences) => void;
  setView: (view: ViewMode) => void;
};

export function useProfileUiPreferenceSync({
  currentProfileId,
  data,
  hasPlanningBoardUrlState,
  hasPlanningFilterUrlState,
  setExpandedPackageIds,
  setFilters,
  setView,
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

    setView(hasPlanningBoardUrlState ? "board" : preference.defaultTaskView);
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
  }, [currentProfileId, hasPlanningBoardUrlState, hasPlanningFilterUrlState, preference, setExpandedPackageIds, setFilters, setView]);
}
