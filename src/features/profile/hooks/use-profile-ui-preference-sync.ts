"use client";

import { useEffect, useMemo, useRef } from "react";
import type { PlanningShellState, PlanningFilterPreferences, ViewMode } from "@/lib/types";

type ProfileUiPreferenceSyncOptions = {
  currentProfileId: string;
  data: PlanningShellState;
  hasPlanningBoardUrlState: boolean;
  hasPlanningFilterUrlState: boolean;
  setExpandedInitiativeIds: (initiativeIds: string[]) => void;
  setFilters: (filters: PlanningFilterPreferences) => void;
  setView: (view: ViewMode) => void;
};

export function useProfileUiPreferenceSync({
  currentProfileId,
  data,
  hasPlanningBoardUrlState,
  hasPlanningFilterUrlState,
  setExpandedInitiativeIds,
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
    setExpandedInitiativeIds(preference.expandedInitiativeIds);
  }, [currentProfileId, hasPlanningBoardUrlState, hasPlanningFilterUrlState, preference, setExpandedInitiativeIds, setFilters, setView]);
}
