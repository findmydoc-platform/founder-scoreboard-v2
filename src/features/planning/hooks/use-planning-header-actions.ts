"use client";

import type { AppWorkspace } from "@/features/planning/organisms/app-sidebar";
import { canManageMilestones } from "@/features/projects/model/milestone-policy";
import type { InitiativeDraft } from "@/features/projects/organisms/initiative-dialog";
import type { MilestoneDraft } from "@/features/projects/organisms/milestone-dialog";
import type { NewTaskDraft } from "@/features/tasks/organisms/new-task-dialog";
import type { PlanningData, Profile, Sprint } from "@/lib/types";

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
  data: PlanningData;
  setInitiativeDialogDefaults: (defaults: Partial<InitiativeDraft> | null) => void;
  setMilestoneDialogDefaults: (defaults: Partial<MilestoneDraft> | null) => void;
  setTaskDialogDefaults: (defaults: Partial<NewTaskDraft> | null) => void;
  workspace: AppWorkspace;
};

export function usePlanningHeaderActions({
  activeSprint,
  currentProfile,
  data,
  setInitiativeDialogDefaults,
  setMilestoneDialogDefaults,
  setTaskDialogDefaults,
  workspace,
}: UsePlanningHeaderActionsOptions): HeaderAction[] {
  if (workspace === "planning") {
    return [{
      id: "new-task",
      label: "Neue Aufgabe",
      variant: "secondary",
      onClick: () => setTaskDialogDefaults({ taskType: "deliverable" }),
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

  if (workspace === "projects" && canManageMilestones(currentProfile?.platformRole)) {
    const initiativeDisabled = data.milestones.length === 0;
    return [
      {
        id: "new-milestone",
        label: "Neuer Meilenstein",
        variant: "primary",
        onClick: () => setMilestoneDialogDefaults({}),
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
