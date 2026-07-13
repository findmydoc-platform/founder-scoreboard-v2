"use client";

import type { TaskMutationCommandContext } from "@/features/tasks/hooks/task-mutation-command-types";
import { useTaskCreateCommand } from "@/features/tasks/hooks/use-task-create-command";
import { useTaskWithdrawCommand } from "@/features/tasks/hooks/use-task-withdraw-command";
import { useTaskGitHubSyncCommand } from "@/features/tasks/hooks/use-task-github-sync-command";
import { useTaskUpdateCommand } from "@/features/tasks/hooks/use-task-update-command";
import { applyOptimisticDeliverableApprovalDecision } from "@/features/planning/model/approval-domain";
import * as taskApi from "@/features/tasks/model/task-api-client";
import type { ApprovalDecisionAction, Task } from "@/lib/types";

export function useTaskMutationCommands(options: TaskMutationCommandContext) {
  const {
    closeTaskPanel,
    setStatusGuardNotice,
    setStatusGuardTaskId,
    setTaskDialogDefaults,
  } = options;

  const { githubSyncNotice, syncLinkedGitHubTasks, syncTaskToGitHub } = useTaskGitHubSyncCommand(options);
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
  const { withdrawTask } = useTaskWithdrawCommand({
    ...options,
    closeTaskPanel,
  });

  const decideTaskApproval = (task: Task, action: ApprovalDecisionAction, note = "") => {
    options.setSaveError("");
    if (options.source !== "supabase") {
      options.applyPlanningDataUpdate((current) => ({
        ...current,
        tasks: current.tasks.map((item) => item.id === task.id
          ? applyOptimisticDeliverableApprovalDecision(item, action, note)
          : item),
      }));
      return;
    }
    options.startTransition(async () => {
      try {
        const { response, body } = await taskApi.decideTaskApprovalRequest(options.apiClient, task.id, action, task.approvalRevision, note);
        if (!response.ok || !body?.task) throw new Error(body?.error || "Freigabeentscheidung konnte nicht gespeichert werden.");
        options.applyPlanningDataUpdate((current) => ({
          ...current,
          tasks: current.tasks.map((item) => item.id === task.id ? body.task! : item),
        }));
      } catch (error) {
        options.setSaveError(error instanceof Error ? error.message : "Freigabeentscheidung konnte nicht gespeichert werden.");
      }
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
