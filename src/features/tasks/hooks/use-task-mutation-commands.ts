"use client";

import type { TaskMutationCommandContext } from "@/features/tasks/hooks/task-mutation-command-types";
import { useTaskCreateCommand } from "@/features/tasks/hooks/use-task-create-command";
import { useTaskDeleteCommand } from "@/features/tasks/hooks/use-task-delete-command";
import { useTaskGitHubSyncCommand } from "@/features/tasks/hooks/use-task-github-sync-command";
import { useTaskUpdateCommand } from "@/features/tasks/hooks/use-task-update-command";

export function useTaskMutationCommands(options: TaskMutationCommandContext) {
  const {
    closeTaskPanel,
    setStatusGuardNotice,
    setStatusGuardTaskId,
    setTaskDialogDefaults,
  } = options;

  const { syncLinkedGitHubTasks, syncTaskToGitHub } = useTaskGitHubSyncCommand(options);
  const { updateTask } = useTaskUpdateCommand({
    ...options,
    setStatusGuardNotice,
    setStatusGuardTaskId,
    syncTaskToGitHub,
  });
  const { createTask } = useTaskCreateCommand({
    ...options,
    setTaskDialogDefaults,
  });
  const { deleteTask } = useTaskDeleteCommand({
    ...options,
    closeTaskPanel,
  });

  return {
    createTask,
    deleteTask,
    syncLinkedGitHubTasks,
    syncTaskToGitHub,
    updateTask,
  };
}
