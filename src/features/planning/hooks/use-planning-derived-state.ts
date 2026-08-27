"use client";

import { usePlanningHeaderActions } from "@/features/planning/hooks/use-planning-header-actions";
import { usePlanningTaskViewModel } from "@/features/planning/hooks/use-planning-task-view-model";
import type { PlanningFilters, usePlanningViewState } from "@/features/planning/hooks/use-planning-view-state";
import { planningWorkspaces } from "@/features/planning/model/planning-app-model";
import type { PlanningLevel } from "@/features/planning/model/planning-level";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import type { PlanningShellState, Profile, ViewMode } from "@/lib/types";

type PlanningViewState = ReturnType<typeof usePlanningViewState>;

type UsePlanningDerivedStateOptions = {
  currentProfile: Profile | null;
  data: PlanningShellState;
  filters: PlanningFilters;
  planningLevel: PlanningLevel;
  setInitiativeDialogDefaults: PlanningViewState["setInitiativeDialogDefaults"];
  setEpicDialogDefaults: PlanningViewState["setEpicDialogDefaults"];
  setTaskDialogDefaults: PlanningViewState["setTaskDialogDefaults"];
  statusGuardTaskId: string | null;
  view: ViewMode;
  workspace: AppWorkspace;
};

export function usePlanningDerivedState({
  currentProfile,
  data,
  filters,
  planningLevel,
  setInitiativeDialogDefaults,
  setEpicDialogDefaults,
  setTaskDialogDefaults,
  statusGuardTaskId,
  view,
  workspace,
}: UsePlanningDerivedStateOptions) {
  const { metrics, visibleTasks } = usePlanningTaskViewModel({ currentProfile, data, filters });
  const filtersAvailable = planningWorkspaces.includes(workspace);
  const headerActions = usePlanningHeaderActions({
    currentProfile,
    data,
    planningLevel,
    setInitiativeDialogDefaults,
    setEpicDialogDefaults,
    setTaskDialogDefaults,
    view,
    workspace,
  });
  const statusGuardTask = statusGuardTaskId ? data.tasks.find((task) => task.id === statusGuardTaskId) : null;

  return {
    filtersAvailable,
    headerActions,
    metrics,
    statusGuardTask,
    visibleTasks,
  };
}
