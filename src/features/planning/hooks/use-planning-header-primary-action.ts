"use client";

import type { Dispatch, SetStateAction } from "react";
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
  setFeedbackDialogOpen: Dispatch<SetStateAction<boolean>>;
  setInitiativeDialogDefaults: Dispatch<SetStateAction<Partial<InitiativeDraft> | null>>;
  setTaskDialogDefaults: Dispatch<SetStateAction<Partial<NewTaskDraft> | null>>;
  workspace: AppWorkspace;
};

export function usePlanningHeaderPrimaryAction({
  activeSprint,
  setFeedbackDialogOpen,
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

  if (workspace === "backlog") {
    return {
      label: "Neuer Vorschlag",
      onClick: () => setTaskDialogDefaults({ taskType: "proposal" }),
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

  if (workspace === "settings") {
    return {
      label: "Feedback erfassen",
      onClick: () => setFeedbackDialogOpen(true),
    };
  }

  return null;
}
