"use client";

import type { Dispatch, SetStateAction } from "react";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import { persistLocalPlanningTasks } from "@/features/planning/hooks/use-local-planning-state";
import {
  founderStatusGuardMessage,
  founderTaskOwnershipGuardMessage,
} from "@/features/planning/model/planning-app-model";
import type { TaskSyncCommand } from "@/features/tasks/hooks/task-mutation-command-types";
import * as taskApi from "@/features/tasks/model/task-api-client";
import { buildClientTaskUpdatePatch, taskUpdateRequestPayload } from "@/features/tasks/model/task-mutation-contract";
import { hasGitHubIssue } from "@/lib/platform";
import type { Task, TaskStatus } from "@/lib/types";

type UseTaskUpdateCommandOptions = Pick<
  PlanningCommandContext,
  | "apiClient"
  | "applyPlanningDataUpdate"
  | "canChangeTaskStatus"
  | "canManageTaskMeta"
  | "data"
  | "githubAppConnected"
  | "setData"
  | "setSaveError"
  | "source"
  | "startTransition"
> & {
  setStatusGuardNotice: Dispatch<SetStateAction<string>>;
  setStatusGuardTaskId: Dispatch<SetStateAction<string | null>>;
  syncTaskToGitHub: TaskSyncCommand;
};

export function useTaskUpdateCommand({
  apiClient,
  applyPlanningDataUpdate,
  canChangeTaskStatus,
  canManageTaskMeta,
  data,
  githubAppConnected,
  setData,
  setSaveError,
  setStatusGuardNotice,
  setStatusGuardTaskId,
  source,
  startTransition,
  syncTaskToGitHub,
}: UseTaskUpdateCommandOptions) {
  const updateTask = (task: Task, patch: Partial<Task>) => {
    setSaveError("");
    setStatusGuardNotice("");
    setStatusGuardTaskId(null);
    const normalized = buildClientTaskUpdatePatch(task, patch, data.profiles, data.packages);
    if (!normalized.ok) {
      setSaveError(normalized.error);
      return;
    }
    const normalizedPatch = normalized.patch;

    if (normalizedPatch.status && !canChangeTaskStatus(task)) {
      setStatusGuardNotice(founderTaskOwnershipGuardMessage());
      setStatusGuardTaskId(task.id);
      return;
    }

    if (normalizedPatch.status && !canManageTaskMeta) {
      const guardedMessage = founderStatusGuardMessage(normalizedPatch.status as TaskStatus);
      if (guardedMessage) {
        setStatusGuardNotice(guardedMessage);
        setStatusGuardTaskId(task.id);
        return;
      }
    }

    applyPlanningDataUpdate((current) => {
      const nextData = {
        ...current,
        tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...normalizedPatch, githubSyncStatus: normalizedPatch.githubSyncStatus || "not_synced", githubSyncError: normalizedPatch.githubSyncStatus ? item.githubSyncError : "" } : item)),
      };

      if (source === "seed") {
        try {
          persistLocalPlanningTasks(nextData.tasks);
        } catch {
          // UI remains usable even if browser storage is unavailable.
        }
      }

      return nextData;
    });

    if (source !== "supabase") return;

    startTransition(async () => {
      try {
        const { response, body } = await taskApi.updateTaskRequest(apiClient, task.id, taskUpdateRequestPayload(normalizedPatch));
        if (!response.ok) {
          throw new Error(body?.error || "Änderung konnte nicht gespeichert werden.");
        }
        if (body?.activities?.length) {
          applyPlanningDataUpdate((current) => ({
            ...current,
            taskActivity: [...body.activities!, ...current.taskActivity],
          }));
        }
        if (body?.task) {
          setData((current) => ({
            ...current,
            tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...body.task } : item)),
          }));
        }
        if (normalizedPatch.status && hasGitHubIssue(task) && githubAppConnected && canManageTaskMeta) {
          syncTaskToGitHub({ ...task, ...normalizedPatch }, { silent: true });
        }
      } catch (error) {
        applyPlanningDataUpdate((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? task : item)),
        }));
        setSaveError(error instanceof Error ? error.message : "Änderung konnte nicht gespeichert werden.");
      }
    });
  };

  return { updateTask };
}
