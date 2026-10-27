"use client";

import { type Dispatch, type SetStateAction } from "react";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import {
  founderCompletedTaskGuardMessage,
  founderStatusGuardMessage,
  founderTaskAssignmentGuardMessage,
} from "@/features/planning/model/planning-app-model";
import type { TaskSyncCommand, TaskUpdateCommand } from "@/features/tasks/hooks/task-mutation-command-types";
import { taskDetailPermissions } from "@/features/tasks/model/task-detail-permissions";
import { hasReviewLockedTaskChanges, isTaskReviewActive, isTaskReviewLocked, reviewLockMessage } from "@/features/reviews/model/task-review-state";
import { buildClientTaskUpdatePatch } from "@/features/tasks/model/task-mutation-contract";
import { hasGitHubIssue } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import type { Task, TaskStatus } from "@/lib/types";

type UseTaskUpdateCommandOptions = Pick<
  PlanningCommandContext,
  | "planningState"
  | "canChangeTaskStatus"
  | "canCorrectOperationally"
  | "canManageFinalTaskStatus"
  | "canManageTaskMeta"
  | "currentProfile"
  | "data"
  | "githubInstallationAvailable"
  | "setSaveError"
  | "startTransition"
> & {
  refreshCurrentWorkspaceModel: () => Promise<void>;
  setStatusGuardNotice: Dispatch<SetStateAction<string>>;
  setStatusGuardTaskId: Dispatch<SetStateAction<string | null>>;
  syncTaskToGitHub: TaskSyncCommand;
};

export function useTaskUpdateCommand({
  planningState,
  canChangeTaskStatus,
  canCorrectOperationally,
  canManageFinalTaskStatus,
  canManageTaskMeta,
  currentProfile,
  data,
  githubInstallationAvailable,
  setSaveError,
  setStatusGuardNotice,
  setStatusGuardTaskId,
  startTransition,
  syncTaskToGitHub,
}: UseTaskUpdateCommandOptions) {

  const updateTask: TaskUpdateCommand = (task: Task, patch: Partial<Task>, options) => {
    setSaveError("");
    setStatusGuardNotice("");
    setStatusGuardTaskId(null);
    const normalized = buildClientTaskUpdatePatch(task, patch, data.profiles, data.tasks);
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
      operationalCorrection: canCorrectOperationally,
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

    if (normalizedPatch.status && !canManageTaskMeta && !canCorrectOperationally && !roleBasedFinalTransition) {
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

    const editor = options?.editor || planningState.beginTaskEdit(task.id);
    const saving = (options?.resave ? editor.resave(normalizedPatch) : editor.save(normalizedPatch)).then((result) => {
      if (!result.ok) {
        setSaveError(result.error);
      } else if (normalizedPatch.status && hasGitHubIssue(task) && githubInstallationAvailable) {
        syncTaskToGitHub({ ...task, ...result.task }, { silent: true });
      }
      return result;
    });
    startTransition(async () => { await saving; });
    return saving;
  };

  return { updateTask };
}
