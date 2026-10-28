"use client";

import { useRef } from "react";
import type { TaskMutationCommandContext } from "@/features/tasks/hooks/task-mutation-command-types";
import { useTaskCreateCommand } from "@/features/tasks/hooks/use-task-create-command";
import { useTaskWithdrawCommand } from "@/features/tasks/hooks/use-task-withdraw-command";
import { useTaskGitHubSyncCommand } from "@/features/tasks/hooks/use-task-github-sync-command";
import { useTaskUpdateCommand } from "@/features/tasks/hooks/use-task-update-command";
import type { ApprovalDecisionAction, Task } from "@/lib/types";

export function useTaskMutationCommands(options: TaskMutationCommandContext) {
  const serverUpdatedAtByTask = useRef(new Map<string, string>());
  const {
    closeTaskPanel,
    setStatusGuardNotice,
    setStatusGuardTaskId,
    setTaskDialogDefaults,
  } = options;

  const { githubSyncNotice, syncLinkedGitHubTasks, syncTaskToGitHub } = useTaskGitHubSyncCommand({
    ...options,
    serverUpdatedAtByTask,
  });
  const { updateTask } = useTaskUpdateCommand({
    ...options,
    setStatusGuardNotice,
    setStatusGuardTaskId,
    syncTaskToGitHub,
  });
  const { createTask } = useTaskCreateCommand({
    ...options,
    setTaskDialogDefaults,
    syncTaskToGitHub,
  });
  const { withdrawTask } = useTaskWithdrawCommand({
    ...options,
    closeTaskPanel,
  });

  const decideTaskApproval = (task: Task, action: ApprovalDecisionAction, note = "") => {
    options.setSaveError("");
    if (action === "reject") {
      options.startTransition(async () => {
        const result = await options.planningState.rejectTask(task, note);
        if (result.ok) closeTaskPanel();
        else options.setSaveError(result.error);
      });
      return;
    }
    options.startTransition(async () => {
      const result = await options.planningState.decideTaskApproval(task,action,note);
      if(!result.ok)options.setSaveError(result.error);
    });
  };

  return {
    createTask,
    decideTaskApproval,
    withdrawTask,
    githubSyncNotice,
    syncLinkedGitHubTasks,
    syncTaskToGitHub,
    updateTask,
  };
}
