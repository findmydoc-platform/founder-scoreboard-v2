"use client";

import type { Dispatch, SetStateAction } from "react";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import type { NewTaskDraft } from "@/features/tasks/organisms/new-task-dialog";
import type { Task } from "@/lib/types";

export type TaskSyncCommand = (task: Task, options?: { createIfMissing?: boolean; silent?: boolean }) => void;

export type TaskUpdateResult =
  | { ok: true; task: Partial<Task> }
  | { ok: false; error: string; status?: number; kind?: "versionConflict" | "sessionSuperseded" | "authorityEnded" | "rejected" | "unconfirmed"; code?: string };

export type TaskActionResult =
  | { ok: true }
  | { ok: false; error: string; status?: number };

export type TaskUpdateOptions = { editor: import("@/features/planning/model/planning-state").PlanningTaskEditor; resave?: boolean };

export type TaskUpdateCommand = (task: Task, patch: Partial<Task>, options?: TaskUpdateOptions) => Promise<TaskUpdateResult>;
export type TaskUpdateHandler = (task: Task, patch: Partial<Task>, options?: TaskUpdateOptions) => void | Promise<TaskUpdateResult>;

export type TaskMutationCommandContext = PlanningCommandContext & {
  closeTaskPanel: () => void;
  refreshCurrentWorkspaceModel: () => Promise<void>;
  setStatusGuardNotice: Dispatch<SetStateAction<string>>;
  setStatusGuardTaskId: Dispatch<SetStateAction<string | null>>;
  setTaskDialogDefaults: Dispatch<SetStateAction<Partial<NewTaskDraft> | null>>;
};
