"use client";

import { useCallback, useMemo, useState, type SetStateAction } from "react";
import type { InitiativeDraft } from "@/features/projects/model/hierarchy-state";
import type { EpicDeleteTarget } from "@/features/projects/organisms/epic-delete-dialog";
import type { EpicDraft } from "@/features/projects/model/hierarchy-state";
import type { SprintPlanningOptions } from "@/features/sprint/model/sprint-planning-options";
import type { NewTaskDraft } from "@/features/tasks/organisms/new-task-dialog";
import type { PlanningLevel } from "@/features/planning/model/planning-level";
import type { PlanningShellState, PlanningFilterPreferences, ViewMode } from "@/lib/types";
import { addDaysIso } from "@/lib/planning-schedule";
import { dateUrlField, enumUrlField, multiEnumUrlField, stringUrlField, useTableUrlState, type TableUrlHistoryMode, type TableUrlSchema } from "@/shared/hooks/use-table-url-state";

export type PlanningFilters = PlanningFilterPreferences;

export { DEFAULT_PLANNING_FILTERS } from "../model/planning-board-query";

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
  sort: enumUrlField<string>("priority", ["priority", "title", "status", "assignee", "sprint", "start", "fixedDate"]),
  direction: enumUrlField("asc", ["asc", "desc"] as const),
};

const planningBoardUrlSchema: TableUrlSchema<PlanningBoardUrlState> = {
  level: enumUrlField("deliverable", ["epic", "initiative", "deliverable"] as const),
  parentId: stringUrlField("all"),
};

type UsePlanningViewStateOptions = {
  initialData: PlanningShellState;
  initialView?: ViewMode;
  initialQuery?: import("../model/planning-board-query").PlanningBoardQuery;
};

export function usePlanningViewState({
  initialData,
  initialQuery,
  initialView,
}: UsePlanningViewStateOptions) {
  const [view, setView] = useState<ViewMode>(() => initialQuery?.view === "complete" ? initialView || "table" : "board");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDialogDefaults, setTaskDialogDefaults] = useState<Partial<NewTaskDraft> | null>(null);
  const [initiativeDialogDefaults, setInitiativeDialogDefaults] = useState<Partial<InitiativeDraft> | null>(null);
  const [epicDialogDefaults, setEpicDialogDefaults] = useState<Partial<EpicDraft> | null>(null);
  const [epicDeleteTarget, setEpicDeleteTarget] = useState<EpicDeleteTarget | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [sprintPlanningOptions, setSprintPlanningOptions] = useState<SprintPlanningOptions>({
    firstSprintNumber: 2,
    anchorStartDate: addDaysIso(initialData.sprints[0]?.startDate || new Date().toISOString().slice(0, 10), 7),
    rhythmWeeks: 2,
    horizonWeeks: 6,
    targetSprintNumber: 0,
  });
  const initialBoardState = useMemo(() => initialQuery ? { level: initialQuery.level, parentId: initialQuery.parentId } : undefined, [initialQuery]);
  const { state: filters, updateState: updateFilters, resetState: resetFilters, hasUrlState: hasPlanningFilterUrlState } = useTableUrlState({ namespace: "tasks", schema: planningFilterSchema, initialState: initialQuery?.filters });
  const {
    state: planningBoardUrlState,
    updateState: updatePlanningBoardUrlState,
    hasUrlState: hasPlanningBoardUrlState,
  } = useTableUrlState({ namespace: "board", schema: planningBoardUrlSchema, initialState: initialBoardState });
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
    epicDeleteTarget,
    epicDialogDefaults,
    mobileNavOpen,
    planningLevel: planningBoardUrlState.level,
    planningParentFilterId: planningBoardUrlState.parentId,
    resetFilters,
    selectedTaskId,
    setFilters,
    setInitiativeDialogDefaults,
    setEpicDeleteTarget,
    setEpicDialogDefaults,
    setMobileNavOpen,
    setPlanningLevel,
    setPlanningParentFilterId,
    setSelectedTaskId,
    setShowFilters,
    setSprintPlanningOptions,
    setTaskDialogDefaults,
    setView,
    showFilters,
    sprintPlanningOptions,
    taskDialogDefaults,
    view,
  };
}
