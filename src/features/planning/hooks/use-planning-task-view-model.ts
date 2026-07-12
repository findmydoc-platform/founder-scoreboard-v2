"use client";

import { useMemo } from "react";
import type { PlanningFilters } from "@/features/planning/hooks/use-planning-view-state";
import { buildPlanningTaskTableViewModel } from "@/features/planning/model/planning-task-table-view-model";
import type { PlanningData, Profile } from "@/lib/types";

type UsePlanningTaskViewModelOptions = {
  currentProfile: Profile | null;
  data: PlanningData;
  filters: PlanningFilters;
};

export function usePlanningTaskViewModel({
  currentProfile,
  data,
  filters,
}: UsePlanningTaskViewModelOptions) {
  return useMemo(
    () => buildPlanningTaskTableViewModel({ currentProfile, data, filters }),
    [currentProfile, data, filters],
  );
}
