"use client";

import { useCallback, useState, type SetStateAction } from "react";
import type { InitiativeDraft } from "@/features/projects/organisms/initiative-dialog";
import type { MilestoneDeleteTarget } from "@/features/projects/organisms/milestone-delete-dialog";
import type { MilestoneDraft } from "@/features/projects/organisms/milestone-dialog";
import type { SprintPlanningOptions } from "@/features/sprint/model/sprint-planning-options";
import type { NewTaskDraft } from "@/features/tasks/organisms/new-task-dialog";
import type { PlanningLevel } from "@/features/planning/model/planning-level";
import type { PlanningShellState, PlanningFilterPreferences, ViewMode } from "@/lib/types";
import { addDaysIso } from "@/lib/planning-schedule";
import { dateUrlField, enumUrlField, multiEnumUrlField, stringUrlField, useTableUrlState, type TableUrlHistoryMode, type TableUrlSchema } from "@/shared/hooks/use-table-url-state";

export type PlanningFilters = PlanningFilterPreferences;

export const DEFAULT_PLANNING_FILTERS: PlanningFilters = {
  query: "",
  assignee: "Alle",
  status: "Alle",
  priority: "Alle",
  review: "Alle",
  initiativeId: "Alle",
  quick: [],
  sprintId: "Alle",
  workstream: "Alle",
  risk: "Alle",
  targetFrom: "",
  targetTo: "",
  sort: "priority",
  direction: "asc",
};

type PlanningBoardUrlState = {
  level: PlanningLevel;
  parentId: string;
};

const planningFilterSchema: TableUrlSchema<PlanningFilters> = {
  query: stringUrlField(),
  assignee: stringUrlField("Alle"),
  status: stringUrlField("Alle"),
  priority: stringUrlField("Alle"),
  review: enumUrlField<string>("Alle", ["Alle", "requested", "changes_requested", "accepted", "partial", "not_requested"]),
  initiativeId: stringUrlField("Alle"),
  quick: multiEnumUrlField<string>([], ["mine", "my-reviews", "open", "critical", "blocked", "week", "high", "evidence"]),
  sprintId: stringUrlField("Alle"),
  workstream: stringUrlField("Alle"),
  risk: stringUrlField("Alle"),
  targetFrom: dateUrlField(),
  targetTo: dateUrlField(),
  sort: enumUrlField<string>("priority", ["priority", "title", "status", "assignee", "sprint", "start", "deadline"]),
  direction: enumUrlField("asc", ["asc", "desc"] as const),
};

const planningBoardUrlSchema: TableUrlSchema<PlanningBoardUrlState> = {
  level: enumUrlField("deliverable", ["epic", "initiative", "deliverable"] as const),
  parentId: stringUrlField("all"),
};

type UsePlanningViewStateOptions = {
  initialData: PlanningShellState;
};

export function usePlanningViewState({
  initialData,
}: UsePlanningViewStateOptions) {
  const [view, setView] = useState<ViewMode>("board");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDialogDefaults, setTaskDialogDefaults] = useState<Partial<NewTaskDraft> | null>(null);
  const [initiativeDialogDefaults, setInitiativeDialogDefaults] = useState<Partial<InitiativeDraft> | null>(null);
  const [milestoneDialogDefaults, setMilestoneDialogDefaults] = useState<Partial<MilestoneDraft> | null>(null);
  const [milestoneDeleteTarget, setMilestoneDeleteTarget] = useState<MilestoneDeleteTarget | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sprintPlanningOptions, setSprintPlanningOptions] = useState<SprintPlanningOptions>({
    firstSprintNumber: 2,
    anchorStartDate: addDaysIso(initialData.sprints[0]?.startDate || new Date().toISOString().slice(0, 10), 7),
    rhythmWeeks: 2,
    horizonWeeks: 6,
    targetSprintNumber: 0,
  });
  const { state: filters, updateState: updateFilters, resetState: resetFilters, hasUrlState: hasPlanningFilterUrlState } = useTableUrlState({ namespace: "tasks", schema: planningFilterSchema });
  const {
    state: planningBoardUrlState,
    updateState: updatePlanningBoardUrlState,
    hasUrlState: hasPlanningBoardUrlState,
  } = useTableUrlState({ namespace: "board", schema: planningBoardUrlSchema });
  const setFilters = useCallback((next: SetStateAction<PlanningFilters>, history: TableUrlHistoryMode = "push") => {
    updateFilters((current) => typeof next === "function" ? next(current) : next, history);
  }, [updateFilters]);
  const setPlanningLevel = useCallback((level: PlanningLevel) => {
    updatePlanningBoardUrlState({ level, parentId: "all" });
  }, [updatePlanningBoardUrlState]);
  const setPlanningParentFilterId = useCallback((parentId: string) => {
    updatePlanningBoardUrlState({ parentId });
  }, [updatePlanningBoardUrlState]);

  return {
    filters,
    hasPlanningBoardUrlState,
    hasPlanningFilterUrlState,
    initiativeDialogDefaults,
    milestoneDeleteTarget,
    milestoneDialogDefaults,
    mobileNavOpen,
    planningLevel: planningBoardUrlState.level,
    planningParentFilterId: planningBoardUrlState.parentId,
    resetFilters,
    selectedTaskId,
    setFilters,
    setInitiativeDialogDefaults,
    setMilestoneDeleteTarget,
    setMilestoneDialogDefaults,
    setMobileNavOpen,
    setPlanningLevel,
    setPlanningParentFilterId,
    setSelectedTaskId,
    setShowFilters,
    setShowNotifications,
    setSprintPlanningOptions,
    setTaskDialogDefaults,
    setView,
    showFilters,
    showNotifications,
    sprintPlanningOptions,
    taskDialogDefaults,
    view,
  };
}
