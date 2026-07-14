"use client";

import { useCallback, useState, type SetStateAction } from "react";
import type { InitiativeDraft } from "@/features/projects/organisms/initiative-dialog";
import type { MilestoneDeleteTarget } from "@/features/projects/organisms/milestone-delete-dialog";
import type { MilestoneDraft } from "@/features/projects/organisms/milestone-dialog";
import type { SprintPlanningOptions } from "@/features/sprint/model/sprint-planning-options";
import type { NewTaskDraft } from "@/features/tasks/organisms/new-task-dialog";
import type { PlanningData, PlanningFilterPreferences, ViewMode } from "@/lib/types";
import { addDaysIso } from "@/lib/planning-schedule";
import { dateUrlField, enumUrlField, multiEnumUrlField, stringUrlField, useTableUrlState, type TableUrlHistoryMode, type TableUrlSchema } from "@/shared/hooks/use-table-url-state";

export type PlanningFilters = PlanningFilterPreferences;

export const DEFAULT_PLANNING_FILTERS: PlanningFilters = {
  query: "",
  assignee: "Alle",
  status: "Alle",
  priority: "Alle",
  packageId: "Alle",
  quick: [],
  sprintId: "Alle",
  workstream: "Alle",
  risk: "Alle",
  targetFrom: "",
  targetTo: "",
  sort: "priority",
  direction: "asc",
};

const planningFilterSchema: TableUrlSchema<PlanningFilters> = {
  query: stringUrlField(),
  assignee: stringUrlField("Alle"),
  status: stringUrlField("Alle"),
  priority: stringUrlField("Alle"),
  packageId: stringUrlField("Alle"),
  quick: multiEnumUrlField<string>([], ["mine", "open", "critical", "blocked", "week", "high", "evidence"]),
  sprintId: stringUrlField("Alle"),
  workstream: stringUrlField("Alle"),
  risk: stringUrlField("Alle"),
  targetFrom: dateUrlField(),
  targetTo: dateUrlField(),
  sort: enumUrlField<string>("priority", ["priority", "title", "status", "assignee", "sprint", "start", "deadline"]),
  direction: enumUrlField("asc", ["asc", "desc"] as const),
};

type UsePlanningViewStateOptions = {
  initialData: PlanningData;
  initialFocusedReviewTaskId: string;
  initialReviewTaskId: string;
};

export function usePlanningViewState({
  initialData,
  initialFocusedReviewTaskId,
  initialReviewTaskId,
}: UsePlanningViewStateOptions) {
  const [view, setView] = useState<ViewMode>("board");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [focusedReviewTaskId, setFocusedReviewTaskId] = useState(initialFocusedReviewTaskId);
  const [selectedReviewDetailTaskId] = useState(initialReviewTaskId);
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
  const setFilters = useCallback((next: SetStateAction<PlanningFilters>, history: TableUrlHistoryMode = "push") => {
    updateFilters((current) => typeof next === "function" ? next(current) : next, history);
  }, [updateFilters]);

  return {
    filters,
    focusedReviewTaskId,
    hasPlanningFilterUrlState,
    initiativeDialogDefaults,
    milestoneDeleteTarget,
    milestoneDialogDefaults,
    mobileNavOpen,
    resetFilters,
    selectedReviewDetailTaskId,
    selectedTaskId,
    setFilters,
    setFocusedReviewTaskId,
    setInitiativeDialogDefaults,
    setMilestoneDeleteTarget,
    setMilestoneDialogDefaults,
    setMobileNavOpen,
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
