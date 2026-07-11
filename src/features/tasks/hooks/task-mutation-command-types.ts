"use client";

import type { Dispatch, SetStateAction } from "react";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import type { NewTaskDraft } from "@/features/tasks/organisms/new-task-dialog";
import type { Task } from "@/lib/types";

export type TaskSyncCommand = (task: Task, options?: { createIfMissing?: boolean; silent?: boolean }) => void;

export type TaskMutationCommandContext = PlanningCommandContext & {
  closeTaskPanel: () => void;
  refreshPlanningData: () => Promise<void>;
  setStatusGuardNotice: Dispatch<SetStateAction<string>>;
  setStatusGuardTaskId: Dispatch<SetStateAction<string | null>>;
  setTaskDialogDefaults: Dispatch<SetStateAction<Partial<NewTaskDraft> | null>>;
};
