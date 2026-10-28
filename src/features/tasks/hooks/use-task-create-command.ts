"use client";

import type { Dispatch, SetStateAction } from "react";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import { profileForAssigneeValue } from "@/features/planning/model/planning-app-model";
import { resolveTaskCreationHierarchy, taskCreationRequestPayload } from "@/features/tasks/model/task-creation-draft";
import type { NewTaskCreateCallbacks, NewTaskDraft } from "@/features/tasks/organisms/new-task-dialog";
import type { TaskSyncCommand } from "./task-mutation-command-types";

type UseTaskCreateCommandOptions = Pick<PlanningCommandContext, "planningState" | "currentProfile" | "data" | "setSaveError" | "startTransition"> & {
  setTaskDialogDefaults: Dispatch<SetStateAction<Partial<NewTaskDraft> | null>>;
  syncTaskToGitHub: TaskSyncCommand;
};

export function useTaskCreateCommand({ planningState, currentProfile, data, setSaveError, setTaskDialogDefaults, startTransition, syncTaskToGitHub }: UseTaskCreateCommandOptions) {
  const createTask = (draft: NewTaskDraft, callbacks: NewTaskCreateCallbacks = {}) => {
    setSaveError("");
    const creationDraft = resolveTaskCreationHierarchy(draft, data.tasks);
    const assignee = profileForAssigneeValue(data.profiles, creationDraft.assignee || currentProfile?.id || "");
    const input = taskCreationRequestPayload({ ...creationDraft, assignee: assignee?.id || creationDraft.assignee });
    startTransition(async () => {
      const result = await planningState.createTask(input);
      if (!result.ok) {
        setSaveError(result.error);
        callbacks.onError?.(result.error);
        return;
      }
      setTaskDialogDefaults(null);
      if (creationDraft.createGitHubIssue && result.task.taskType === "deliverable") syncTaskToGitHub(result.task, { createIfMissing: true });
    });
  };
  return { createTask };
}
