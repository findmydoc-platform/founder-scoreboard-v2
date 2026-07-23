"use client";

import { useRef, type Dispatch, type SetStateAction } from "react";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import {
  founderCompletedTaskGuardMessage,
  founderStatusGuardMessage,
  founderTaskAssignmentGuardMessage,
} from "@/features/planning/model/planning-app-model";
import { applyDeliverableApprovalPatch } from "@/features/planning/model/approval-domain";
import type { TaskSyncCommand, TaskUpdateCommand, TaskUpdateResult } from "@/features/tasks/hooks/task-mutation-command-types";
import * as taskApi from "@/features/tasks/model/task-api-client";
import { taskDetailPermissions } from "@/features/tasks/model/task-detail-permissions";
import { hasReviewLockedTaskChanges, isTaskReviewActive, isTaskReviewLocked, reviewLockMessage } from "@/features/reviews/model/task-review-state";
import { buildClientTaskUpdatePatch, taskUpdateRequestPayload } from "@/features/tasks/model/task-mutation-contract";
import { taskServerRevision, type TaskServerRevisionStore } from "@/features/tasks/model/task-server-revision";
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
  | "currentProfile"
  | "data"
  | "githubInstallationAvailable"
  | "setData"
  | "setSaveError"
  | "startTransition"
> & {
  refreshPlanningData: () => Promise<void>;
  setStatusGuardNotice: Dispatch<SetStateAction<string>>;
  setStatusGuardTaskId: Dispatch<SetStateAction<string | null>>;
  serverUpdatedAtByTask: TaskServerRevisionStore;
  syncTaskToGitHub: TaskSyncCommand;
};

export function useTaskUpdateCommand({
  apiClient,
  applyPlanningDataUpdate,
  canChangeTaskStatus,
  canManageFinalTaskStatus,
  canManageTaskMeta,
  currentProfile,
  data,
  githubInstallationAvailable,
  refreshPlanningData,
  setData,
  setSaveError,
  setStatusGuardNotice,
  setStatusGuardTaskId,
  serverUpdatedAtByTask,
  startTransition,
  syncTaskToGitHub,
}: UseTaskUpdateCommandOptions) {
  const latestMutationByTask = useRef(new Map<string, symbol>());
  const mutationEpochByTask = useRef(new Map<string, number>());
  const mutationQueueByTask = useRef(new Map<string, Promise<TaskUpdateResult>>());

  const updateTask: TaskUpdateCommand = (task: Task, patch: Partial<Task>) => {
    setSaveError("");
    setStatusGuardNotice("");
    setStatusGuardTaskId(null);
    const normalized = buildClientTaskUpdatePatch(task, patch, data.profiles, data.packages);
    if (!normalized.ok) {
      setSaveError(normalized.error);
      return Promise.resolve({ ok: false, error: normalized.error, status: 400 });
    }
    const normalizedPatch = normalized.patch;
    if (isTaskReviewLocked(task) && hasReviewLockedTaskChanges(normalizedPatch, { allowReviewOwnerChange: isTaskReviewActive(task) })) {
      const message = reviewLockMessage(task);
      setSaveError(message);
      return Promise.resolve({ ok: false, error: message, status: 409 });
    }
    const currentStatus = normalizeStatus(task.status);
    const targetStatus = normalizedPatch.status ? normalizeStatus(normalizedPatch.status) : null;
    const detailPermissions = taskDetailPermissions({
      task,
      profile: currentProfile,
      unrestricted: false,
    });
    const completesSubIssue = task.taskType === "sub_issue"
      && currentStatus !== "Erledigt"
      && targetStatus === "Erledigt"
      && detailPermissions.canCompleteSubIssue;
    const reopensSubIssue = task.taskType === "sub_issue"
      && currentStatus === "Erledigt"
      && targetStatus === "Offen"
      && detailPermissions.canReopenSubIssue;
    const roleBasedFinalTransition = completesSubIssue || reopensSubIssue;

    if (targetStatus === "Erledigt" && !canManageFinalTaskStatus && !roleBasedFinalTransition) {
      setStatusGuardNotice(founderStatusGuardMessage(normalizedPatch.status as TaskStatus));
      setStatusGuardTaskId(task.id);
      return Promise.resolve({ ok: false, error: founderStatusGuardMessage(normalizedPatch.status as TaskStatus), status: 403 });
    }

    if (normalizedPatch.status && !canManageTaskMeta && !roleBasedFinalTransition) {
      const guardedMessage = founderStatusGuardMessage(normalizedPatch.status as TaskStatus, task.status);
      if (guardedMessage) {
        setStatusGuardNotice(guardedMessage);
        setStatusGuardTaskId(task.id);
        return Promise.resolve({ ok: false, error: guardedMessage, status: 403 });
      }
    }

    if (normalizedPatch.status && currentStatus === "Erledigt" && !canManageFinalTaskStatus && !roleBasedFinalTransition) {
      setStatusGuardNotice(founderCompletedTaskGuardMessage());
      setStatusGuardTaskId(task.id);
      return Promise.resolve({ ok: false, error: founderCompletedTaskGuardMessage(), status: 403 });
    }

    if (normalizedPatch.status && !canChangeTaskStatus(task) && !roleBasedFinalTransition) {
      setStatusGuardNotice(founderTaskAssignmentGuardMessage());
      setStatusGuardTaskId(task.id);
      return Promise.resolve({ ok: false, error: founderTaskAssignmentGuardMessage(), status: 403 });
    }

    applyPlanningDataUpdate((current) => {
      const nextData = {
        ...current,
        tasks: current.tasks.map((item) => (item.id === task.id ? {
          ...item,
          ...normalizedPatch,
          githubIssueSyncStatus: "not_synced" as const,
          githubIssueSyncError: "",
          githubIssueSyncPendingSince: "",
        } : item)),
      };

      return nextData;
    });

    const mutationId = Symbol(task.id);
    const mutationEpoch = mutationEpochByTask.current.get(task.id) || 0;
    latestMutationByTask.current.set(task.id, mutationId);
    const previousMutation = mutationQueueByTask.current.get(task.id) || Promise.resolve<TaskUpdateResult>({ ok: true, task: {} });
    const queuedMutation: Promise<TaskUpdateResult> = previousMutation.then(async (): Promise<TaskUpdateResult> => {
      if ((mutationEpochByTask.current.get(task.id) || 0) !== mutationEpoch) {
        return { ok: false, error: "Aufgabe wurde zwischenzeitlich geändert. Der aktuelle Stand wurde neu geladen.", status: 409 };
      }

      try {
        const { response, body } = await taskApi.updateTaskRequest(
          apiClient,
          task.id,
          taskUpdateRequestPayload(
            normalizedPatch,
            taskServerRevision(serverUpdatedAtByTask, task),
          ),
        );
        if (response.status === 409) {
          mutationEpochByTask.current.set(task.id, mutationEpoch + 1);
          serverUpdatedAtByTask.current.delete(task.id);
          const error = body?.error || "Aufgabe wurde zwischenzeitlich geändert. Der aktuelle Stand wurde neu geladen.";
          try {
            await refreshPlanningData();
          } catch {
            // The authoritative refresh is best-effort after a rejected mutation.
          }
          setSaveError(error);
          return { ok: false, error, status: 409 };
        }
        if (!response.ok) {
          throw Object.assign(new Error(body?.error || "Änderung konnte nicht gespeichert werden."), { status: response.status });
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
          setData((current) => body.task?.approvalStatus !== undefined && task.taskType === "deliverable"
            ? applyDeliverableApprovalPatch(current, {
                ...body.task,
                id: task.id,
                approvalStatus: body.task.approvalStatus,
              })
            : {
                ...current,
                tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...body.task } : item)),
              });
        }
        if (normalizedPatch.status && hasGitHubIssue(task) && githubInstallationAvailable) {
          syncTaskToGitHub({ ...task, ...normalizedPatch }, { silent: true });
        }
        return { ok: true, task: body?.task || normalizedPatch };
      } catch (error) {
        mutationEpochByTask.current.set(task.id, mutationEpoch + 1);
        serverUpdatedAtByTask.current.delete(task.id);
        try {
          await refreshPlanningData();
        } catch {
          // The authoritative refresh is best-effort after a failed mutation.
        }
        const message = error instanceof Error ? error.message : "Änderung konnte nicht gespeichert werden.";
        const status = typeof error === "object" && error !== null && "status" in error && typeof error.status === "number"
          ? error.status
          : undefined;
        setSaveError(message);
        return { ok: false, error: message, status };
      }
    });
    mutationQueueByTask.current.set(task.id, queuedMutation);
    startTransition(() => {
      void queuedMutation.then(() => {
        if (mutationQueueByTask.current.get(task.id) === queuedMutation) {
          mutationQueueByTask.current.delete(task.id);
          latestMutationByTask.current.delete(task.id);
        }
      });
    });
    return queuedMutation;
  };

  return { updateTask };
}
