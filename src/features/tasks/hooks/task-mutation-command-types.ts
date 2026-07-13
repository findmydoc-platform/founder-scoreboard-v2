"use client";

import type { Dispatch, SetStateAction } from "react";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import type { NewTaskDraft } from "@/features/tasks/organisms/new-task-dialog";
import type { Task } from "@/lib/types";

export type TaskSyncCommand = (task: Task, options?: { createIfMissing?: boolean; silent?: boolean }) => void;

export type TaskUpdateResult =
  | { ok: true; task: Partial<Task> }
  | { ok: false; error: string; status?: number };

export type TaskUpdateCommand = (task: Task, patch: Partial<Task>) => Promise<TaskUpdateResult>;
export type TaskUpdateHandler = (task: Task, patch: Partial<Task>) => void | Promise<TaskUpdateResult>;

export type TaskMutationCommandContext = PlanningCommandContext & {
  closeTaskPanel: () => void;
  refreshPlanningData: () => Promise<void>;
  setStatusGuardNotice: Dispatch<SetStateAction<string>>;
  setStatusGuardTaskId: Dispatch<SetStateAction<string | null>>;
  setTaskDialogDefaults: Dispatch<SetStateAction<Partial<NewTaskDraft> | null>>;
};
