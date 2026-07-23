"use client";

import { usePlanningHeaderActions } from "@/features/planning/hooks/use-planning-header-actions";
import { usePlanningTaskViewModel } from "@/features/planning/hooks/use-planning-task-view-model";
import type { PlanningFilters, usePlanningViewState } from "@/features/planning/hooks/use-planning-view-state";
import { planningWorkspaces } from "@/features/planning/model/planning-app-model";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import { findCurrentSprint } from "@/lib/planning-schedule";
import type { PlanningData, Profile } from "@/lib/types";

type PlanningViewState = ReturnType<typeof usePlanningViewState>;

type UsePlanningDerivedStateOptions = {
  currentProfile: Profile | null;
  data: PlanningData;
  filters: PlanningFilters;
  setInitiativeDialogDefaults: PlanningViewState["setInitiativeDialogDefaults"];
  setMilestoneDialogDefaults: PlanningViewState["setMilestoneDialogDefaults"];
  setTaskDialogDefaults: PlanningViewState["setTaskDialogDefaults"];
  statusGuardTaskId: string | null;
  workspace: AppWorkspace;
};

export function usePlanningDerivedState({
  currentProfile,
  data,
  filters,
  setInitiativeDialogDefaults,
  setMilestoneDialogDefaults,
  setTaskDialogDefaults,
  statusGuardTaskId,
  workspace,
}: UsePlanningDerivedStateOptions) {
  const { metrics, visibleTasks } = usePlanningTaskViewModel({ currentProfile, data, filters });
  const activeSprint = findCurrentSprint(data.sprints) || data.sprints[0];
  const filtersAvailable = planningWorkspaces.includes(workspace);
  const headerActions = usePlanningHeaderActions({
    activeSprint,
    currentProfile,
    data,
    setInitiativeDialogDefaults,
    setMilestoneDialogDefaults,
    setTaskDialogDefaults,
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
