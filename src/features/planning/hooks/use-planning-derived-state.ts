"use client";

import { useEffect } from "react";
import { usePlanningHeaderPrimaryAction } from "@/features/planning/hooks/use-planning-header-primary-action";
import { usePlanningTaskViewModel } from "@/features/planning/hooks/use-planning-task-view-model";
import type { PlanningFilters, usePlanningViewState } from "@/features/planning/hooks/use-planning-view-state";
import { planningWorkspaces } from "@/features/planning/model/planning-app-model";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import { findCurrentSprint } from "@/lib/planning-schedule";
import type { PlanningData, Profile } from "@/lib/types";

type PlanningViewState = ReturnType<typeof usePlanningViewState>;

type UsePlanningDerivedStateOptions = {
  authChecked: boolean;
  canUseCeoIntake: boolean;
  currentProfile: Profile | null;
  data: PlanningData;
  filters: PlanningFilters;
  legacyMineWorkspace: boolean;
  setFilters: PlanningViewState["setFilters"];
  setInitiativeDialogDefaults: PlanningViewState["setInitiativeDialogDefaults"];
  setTaskDialogDefaults: PlanningViewState["setTaskDialogDefaults"];
  setWorkspace: (workspace: AppWorkspace) => void;
  statusGuardTaskId: string | null;
  workspace: AppWorkspace;
};

export function usePlanningDerivedState({
  authChecked,
  canUseCeoIntake,
  currentProfile,
  data,
  filters,
  legacyMineWorkspace,
  setFilters,
  setInitiativeDialogDefaults,
  setTaskDialogDefaults,
  setWorkspace,
  statusGuardTaskId,
  workspace,
}: UsePlanningDerivedStateOptions) {
  useEffect(() => {
    if (workspace === "ceo-intake" && authChecked && !canUseCeoIntake) {
      setWorkspace("planning");
    }
  }, [authChecked, canUseCeoIntake, setWorkspace, workspace]);

  useEffect(() => {
    if (!legacyMineWorkspace) return;
    setFilters((current) => ({ ...current, assignee: "Alle", quick: Array.from(new Set(["mine", ...current.quick])) }));
  }, [legacyMineWorkspace, setFilters]);

  const { metrics, visibleTasks } = usePlanningTaskViewModel({ currentProfile, data, filters });
  const activeSprint = findCurrentSprint(data.sprints) || data.sprints[0];
  const filtersAvailable = planningWorkspaces.includes(workspace);
  const headerPrimaryAction = usePlanningHeaderPrimaryAction({
    activeSprint,
    setInitiativeDialogDefaults,
    setTaskDialogDefaults,
    workspace,
  });
  const statusGuardTask = statusGuardTaskId ? data.tasks.find((task) => task.id === statusGuardTaskId) : null;

  return {
    filtersAvailable,
    headerPrimaryAction,
    metrics,
    statusGuardTask,
    visibleTasks,
  };
}
