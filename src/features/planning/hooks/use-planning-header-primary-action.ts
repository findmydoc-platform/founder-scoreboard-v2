"use client";

import type { AppWorkspace } from "@/features/planning/organisms/app-sidebar";
import type { InitiativeDraft } from "@/features/projects/organisms/initiative-dialog";
import type { NewTaskDraft } from "@/features/tasks/organisms/new-task-dialog";
import type { Sprint } from "@/lib/types";

export type HeaderPrimaryAction = {
  label: string;
  onClick: () => void;
};

type UsePlanningHeaderPrimaryActionOptions = {
  activeSprint?: Sprint;
  setInitiativeDialogDefaults: (defaults: Partial<InitiativeDraft> | null) => void;
  setTaskDialogDefaults: (defaults: Partial<NewTaskDraft> | null) => void;
  workspace: AppWorkspace;
};

export function usePlanningHeaderPrimaryAction({
  activeSprint,
  setInitiativeDialogDefaults,
  setTaskDialogDefaults,
  workspace,
}: UsePlanningHeaderPrimaryActionOptions): HeaderPrimaryAction | null {
  if (workspace === "planning") {
    return {
      label: "Neue Aufgabe",
      onClick: () => setTaskDialogDefaults({ taskType: "deliverable" }),
    };
  }

  if (workspace === "sprint") {
    return {
      label: "Aufgabe hinzufügen",
      onClick: () =>
        setTaskDialogDefaults({
          taskType: "deliverable",
          sprintId: activeSprint?.id || "",
          startDate: activeSprint?.startDate || "",
          endDate: activeSprint?.endDate || "",
        }),
    };
  }

  if (workspace === "projects") {
    return {
      label: "Neue Initiative",
      onClick: () => setInitiativeDialogDefaults({}),
    };
  }

  return null;
}
