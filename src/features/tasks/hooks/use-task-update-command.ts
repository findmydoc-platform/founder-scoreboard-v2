"use client";

import { useRef, type Dispatch, type SetStateAction } from "react";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import { persistLocalPlanningTasks } from "@/features/planning/hooks/use-local-planning-state";
import {
  founderCompletedTaskGuardMessage,
  founderStatusGuardMessage,
  founderTaskAssignmentGuardMessage,
} from "@/features/planning/model/planning-app-model";
import type { TaskSyncCommand } from "@/features/tasks/hooks/task-mutation-command-types";
import * as taskApi from "@/features/tasks/model/task-api-client";
import { buildClientTaskUpdatePatch, taskUpdateRequestPayload } from "@/features/tasks/model/task-mutation-contract";
import { hasGitHubIssue } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import type { Task, TaskStatus } from "@/lib/types";

type UseTaskUpdateCommandOptions = Pick<
  PlanningCommandContext,
  | "apiClient"
  | "applyPlanningDataUpdate"
  | "canChangeTaskStatus"
  | "canManageFinalTaskStatus"
  | "canManageTaskMeta"
  | "data"
  | "githubInstallationAvailable"
  | "setData"
  | "setSaveError"
  | "source"
  | "startTransition"
> & {
  refreshPlanningData: () => Promise<void>;
  setStatusGuardNotice: Dispatch<SetStateAction<string>>;
  setStatusGuardTaskId: Dispatch<SetStateAction<string | null>>;
  syncTaskToGitHub: TaskSyncCommand;
};

export function useTaskUpdateCommand({
  apiClient,
  applyPlanningDataUpdate,
  canChangeTaskStatus,
  canManageFinalTaskStatus,
  canManageTaskMeta,
  data,
  githubInstallationAvailable,
  refreshPlanningData,
  setData,
  setSaveError,
  setStatusGuardNotice,
  setStatusGuardTaskId,
  source,
  startTransition,
  syncTaskToGitHub,
}: UseTaskUpdateCommandOptions) {
  const latestMutationByTask = useRef(new Map<string, symbol>());
  const mutationEpochByTask = useRef(new Map<string, number>());
  const mutationQueueByTask = useRef(new Map<string, Promise<void>>());
  const serverUpdatedAtByTask = useRef(new Map<string, string>());

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

    if (normalizedPatch.status && !canManageFinalTaskStatus && normalizeStatus(normalizedPatch.status) === "Erledigt") {
      setStatusGuardNotice(founderStatusGuardMessage(normalizedPatch.status as TaskStatus));
      setStatusGuardTaskId(task.id);
      return;
    }

    if (normalizedPatch.status && !canManageTaskMeta) {
      const guardedMessage = founderStatusGuardMessage(normalizedPatch.status as TaskStatus, task.status);
      if (guardedMessage) {
        setStatusGuardNotice(guardedMessage);
        setStatusGuardTaskId(task.id);
        return;
      }
    }

    if (normalizedPatch.status && normalizeStatus(task.status) === "Erledigt" && !canManageFinalTaskStatus) {
      setStatusGuardNotice(founderCompletedTaskGuardMessage());
      setStatusGuardTaskId(task.id);
      return;
    }

    if (normalizedPatch.status && !canChangeTaskStatus(task)) {
      setStatusGuardNotice(founderTaskAssignmentGuardMessage());
      setStatusGuardTaskId(task.id);
      return;
    }

    applyPlanningDataUpdate((current) => {
      const nextData = {
        ...current,
        tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...normalizedPatch, githubIssueSyncStatus: normalizedPatch.githubIssueSyncStatus || "not_synced", githubIssueSyncError: normalizedPatch.githubIssueSyncStatus ? item.githubIssueSyncError : "" } : item)),
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

    const mutationId = Symbol(task.id);
    const mutationEpoch = mutationEpochByTask.current.get(task.id) || 0;
    latestMutationByTask.current.set(task.id, mutationId);
    const previousMutation = mutationQueueByTask.current.get(task.id) || Promise.resolve();
    const queuedMutation = previousMutation.then(async () => {
      if ((mutationEpochByTask.current.get(task.id) || 0) !== mutationEpoch) return;

      try {
        const { response, body } = await taskApi.updateTaskRequest(
          apiClient,
          task.id,
          taskUpdateRequestPayload(
            normalizedPatch,
            serverUpdatedAtByTask.current.get(task.id) || task.updatedAt || "",
          ),
        );
        if (response.status === 409) {
          mutationEpochByTask.current.set(task.id, mutationEpoch + 1);
          serverUpdatedAtByTask.current.delete(task.id);
          await refreshPlanningData();
          setSaveError(body?.error || "Aufgabe wurde zwischenzeitlich geändert. Der aktuelle Stand wurde neu geladen.");
          return;
        }
        if (!response.ok) {
          throw new Error(body?.error || "Änderung konnte nicht gespeichert werden.");
        }
        if (body?.task?.updatedAt) {
          serverUpdatedAtByTask.current.set(task.id, body.task.updatedAt);
        }
        if (body?.activities?.length) {
          applyPlanningDataUpdate((current) => ({
            ...current,
            taskActivity: [...body.activities!, ...current.taskActivity],
          }));
        }
        if (body?.task && latestMutationByTask.current.get(task.id) === mutationId) {
          setData((current) => ({
            ...current,
            tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...body.task } : item)),
          }));
        }
        if (normalizedPatch.status && hasGitHubIssue(task) && githubInstallationAvailable) {
          syncTaskToGitHub({ ...task, ...normalizedPatch }, { silent: true });
        }
      } catch (error) {
        mutationEpochByTask.current.set(task.id, mutationEpoch + 1);
        serverUpdatedAtByTask.current.delete(task.id);
        await refreshPlanningData();
        setSaveError(error instanceof Error ? error.message : "Änderung konnte nicht gespeichert werden.");
      }
    });
    mutationQueueByTask.current.set(task.id, queuedMutation);
    startTransition(async () => {
      await queuedMutation;
      if (mutationQueueByTask.current.get(task.id) === queuedMutation) {
        mutationQueueByTask.current.delete(task.id);
        latestMutationByTask.current.delete(task.id);
      }
    });
  };

  return { updateTask };
}
