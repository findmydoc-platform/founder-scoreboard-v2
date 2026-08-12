"use client";

import type { AppWorkspace } from "@/features/planning/organisms/app-sidebar";
import { canManageEpics } from "@/features/projects/model/epic-policy";
import type { InitiativeDraft } from "@/features/projects/organisms/initiative-dialog";
import type { EpicDraft } from "@/features/projects/organisms/epic-dialog";
import type { NewTaskDraft } from "@/features/tasks/organisms/new-task-dialog";
import { planningLevelCreateLabel, type PlanningLevel } from "@/features/planning/model/planning-level";
import { epicPlanningItems } from "@/features/planning/model/planning-app-model";
import type { PlanningShellState, Profile, Sprint, ViewMode } from "@/lib/types";

export type HeaderAction = {
  id: string;
  label: string;
  variant: "primary" | "secondary";
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
};

type UsePlanningHeaderActionsOptions = {
  activeSprint?: Sprint;
  currentProfile: Profile | null;
  data: PlanningShellState;
  planningLevel?: PlanningLevel;
  setInitiativeDialogDefaults: (defaults: Partial<InitiativeDraft> | null) => void;
  setEpicDialogDefaults: (defaults: Partial<EpicDraft> | null) => void;
  setTaskDialogDefaults: (defaults: Partial<NewTaskDraft> | null) => void;
  view?: ViewMode;
  workspace: AppWorkspace;
};

export function usePlanningHeaderActions({
  activeSprint,
  currentProfile,
  data,
  planningLevel = "deliverable",
  setInitiativeDialogDefaults,
  setEpicDialogDefaults,
  setTaskDialogDefaults,
  view = "board",
  workspace,
}: UsePlanningHeaderActionsOptions): HeaderAction[] {
  if (workspace === "planning") {
    const taskType = view === "board" ? planningLevel : "deliverable";
    return [{
      id: "new-task",
      label: planningLevelCreateLabel(taskType),
      variant: "secondary",
      onClick: () => setTaskDialogDefaults({ taskType }),
    }];
  }

  if (workspace === "sprint") {
    return [{
      id: "add-task",
      label: "Aufgabe hinzufügen",
      variant: "secondary",
      onClick: () => setTaskDialogDefaults({
        taskType: "deliverable",
        sprintId: activeSprint?.id || "",
        startDate: activeSprint?.startDate || "",
        endDate: activeSprint?.endDate || "",
      }),
    }];
  }

  if (workspace === "projects" && canManageEpics(currentProfile?.platformRole)) {
    const initiativeDisabled = epicPlanningItems(data.tasks).length === 0;
    return [
      {
        id: "new-epic",
        label: "Neuer Meilenstein",
        variant: "primary",
        onClick: () => setEpicDialogDefaults({}),
      },
      {
        id: "new-initiative",
        label: "Neue Initiative",
        variant: "secondary",
        disabled: initiativeDisabled,
        disabledReason: initiativeDisabled ? "Lege zuerst einen Meilenstein an." : undefined,
        onClick: () => setInitiativeDialogDefaults({}),
      },
    ];
  }

  return [];
}
