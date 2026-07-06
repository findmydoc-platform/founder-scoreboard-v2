"use client";

import { useEffect, useState } from "react";
import type { InitiativeDraft } from "@/features/projects/organisms/initiative-dialog";
import type { SprintPlanningOptions } from "@/features/settings/molecules/settings-sprint-planning";
import type { NewTaskDraft } from "@/features/tasks/organisms/new-task-dialog";
import type { ReviewOwnerFilter, ReviewStatusFilter } from "@/features/reviews/model/review-workspace-view-model";
import type { PlanningData, ViewMode } from "@/lib/types";
import { addDaysIso } from "@/lib/planning-schedule";

export type PlanningFilters = {
  query: string;
  owner: string;
  status: string;
  priority: string;
  packageId: string;
  quick: string;
};

const planningFiltersSessionKey = "fmd-planning-filters-v1";

const defaultPlanningFilters: PlanningFilters = {
  query: "",
  owner: "Alle",
  status: "Alle",
  priority: "Alle",
  packageId: "Alle",
  quick: "",
};

function isFilterString(value: unknown): value is string {
  return typeof value === "string";
}

function normalizePlanningFilters(value: unknown): PlanningFilters {
  if (!value || typeof value !== "object") return defaultPlanningFilters;

  const candidate = value as Partial<Record<keyof PlanningFilters, unknown>>;

  return {
    query: isFilterString(candidate.query) ? candidate.query : defaultPlanningFilters.query,
    owner: isFilterString(candidate.owner) ? candidate.owner : defaultPlanningFilters.owner,
    status: isFilterString(candidate.status) ? candidate.status : defaultPlanningFilters.status,
    priority: isFilterString(candidate.priority) ? candidate.priority : defaultPlanningFilters.priority,
    packageId: isFilterString(candidate.packageId) ? candidate.packageId : defaultPlanningFilters.packageId,
    quick: isFilterString(candidate.quick) ? candidate.quick : defaultPlanningFilters.quick,
  };
}

function readPlanningFiltersFromSession(): PlanningFilters {
  if (typeof window === "undefined") return defaultPlanningFilters;

  try {
    return normalizePlanningFilters(JSON.parse(window.sessionStorage.getItem(planningFiltersSessionKey) || "null"));
  } catch {
    return defaultPlanningFilters;
  }
}

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
  const [reviewStatusFilter, setReviewStatusFilter] = useState<ReviewStatusFilter>("open");
  const [reviewOwnerFilter, setReviewOwnerFilter] = useState<ReviewOwnerFilter>("all");
  const [taskDialogDefaults, setTaskDialogDefaults] = useState<Partial<NewTaskDraft> | null>(null);
  const [initiativeDialogDefaults, setInitiativeDialogDefaults] = useState<Partial<InitiativeDraft> | null>(null);
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
  const [selectedFeedbackId, setSelectedFeedbackId] = useState<number | null>(null);
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
  const [filters, setFilters] = useState<PlanningFilters>(() => readPlanningFiltersFromSession());

  useEffect(() => {
    window.sessionStorage.setItem(planningFiltersSessionKey, JSON.stringify(filters));
  }, [filters]);

  return {
    feedbackDialogOpen,
    filters,
    focusedReviewTaskId,
    initiativeDialogDefaults,
    mobileNavOpen,
    reviewOwnerFilter,
    reviewStatusFilter,
    selectedFeedbackId,
    selectedReviewDetailTaskId,
    selectedTaskId,
    setFeedbackDialogOpen,
    setFilters,
    setFocusedReviewTaskId,
    setInitiativeDialogDefaults,
    setMobileNavOpen,
    setReviewOwnerFilter,
    setReviewStatusFilter,
    setSelectedFeedbackId,
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
