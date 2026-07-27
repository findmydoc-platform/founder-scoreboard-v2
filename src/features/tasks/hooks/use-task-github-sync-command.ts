"use client";

import { useState } from "react";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import { githubBulkSyncTasks } from "@/features/tasks/model/github-sync-queue";
import * as taskApi from "@/features/tasks/model/task-api-client";
import { rememberTaskServerRevision, type TaskServerRevisionStore } from "@/features/tasks/model/task-server-revision";
import { classifyTaskGitHubSyncResponse } from "@/lib/github-sync/contract";
import { hasGitHubIssue } from "@/lib/platform";
import type { Task } from "@/lib/types";

type UseTaskGitHubSyncCommandOptions = Pick<
  PlanningCommandContext,
  "apiClient" | "data" | "setData" | "setSaveError" | "source" | "startTransition"
> & {
  serverUpdatedAtByTask: TaskServerRevisionStore;
};

const syncLockedMessage = "GitHub-Sync läuft bereits.";

export function useTaskGitHubSyncCommand({
  apiClient,
  data,
  setData,
  setSaveError,
  serverUpdatedAtByTask,
  source,
  startTransition,
}: UseTaskGitHubSyncCommandOptions) {
  const [githubSyncNotice, setGithubSyncNotice] = useState("");
  const syncTaskToGitHub = (task: Task, options: { createIfMissing?: boolean; silent?: boolean } = {}) => {
    if (!options.silent) {
      setSaveError("");
      setGithubSyncNotice("");
    }

    const previousSyncState = {
      githubIssueSyncStatus: task.githubIssueSyncStatus,
      githubIssueSyncError: task.githubIssueSyncError,
      githubIssueSyncPendingSince: task.githubIssueSyncPendingSince,
    };
    const syncStartedAt = new Date().toISOString();
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((item) => (item.id === task.id ? {
        ...item,
        githubIssueSyncStatus: "pending",
        githubIssueSyncError: "",
        githubIssueSyncPendingSince: syncStartedAt,
      } : item)),
    }));

    if (source !== "supabase") {
      setSaveError("GitHub-Sync ist in diesem Arbeitsmodus nicht verfügbar.");
      setData((current) => ({
        ...current,
        tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...previousSyncState } : item)),
      }));
      return;
    }

    startTransition(async () => {
      let serverTaskPatch: Partial<Task> | undefined;
      try {
        const { response, body } = await taskApi.syncTaskToGitHubRequest(apiClient, task.id, { createIfMissing: Boolean(options.createIfMissing) });
        const classification = classifyTaskGitHubSyncResponse(response.status, body);
        serverTaskPatch = classification.result.task;
        rememberTaskServerRevision(serverUpdatedAtByTask, task.id, classification.result.task?.updatedAt);
        if (classification.kind === "locked") {
          setData((current) => ({
            ...current,
            tasks: current.tasks.map((item) => (item.id === task.id ? {
              ...item,
              githubIssueSyncStatus: "pending",
              githubIssueSyncError: classification.result.error || syncLockedMessage,
              githubIssueSyncPendingSince: syncStartedAt,
            } : item)),
          }));
          if (!options.silent) setSaveError(classification.result.error || syncLockedMessage);
          return;
        }
        if (classification.kind === "retryable") {
          const retryableMessage = classification.result.error;
          setData((current) => ({
            ...current,
            tasks: current.tasks.map((item) => (item.id === task.id ? {
              ...item,
              ...classification.result.task,
              githubIssueSyncStatus: classification.taskStatus,
              githubIssueSyncError: retryableMessage,
              githubIssueSyncPendingSince: "",
            } : item)),
          }));
          if (!options.silent) setSaveError(retryableMessage);
          return;
        }
        if (classification.kind === "failure") throw new Error(classification.result.error);
        const success = classification.result;

        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...serverTaskPatch, githubIssueSyncPendingSince: "" } : item)),
        }));
        if (!options.silent) setGithubSyncNotice(success.notices[0]?.message || "");
      } catch (error) {
        const message = error instanceof Error ? error.message : "GitHub-Sync konnte nicht ausgeführt werden.";
        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? {
            ...item,
            ...serverTaskPatch,
            githubIssueSyncStatus: "failed",
            githubIssueSyncError: message,
            githubIssueSyncPendingSince: "",
          } : item)),
        }));
        if (!options.silent) setSaveError(message);
      }
    });
  };

  const syncLinkedGitHubTasks = (options: { onlyFailed?: boolean } = {}) => {
    setSaveError("");
    setGithubSyncNotice("");

    if (source !== "supabase") {
      setSaveError("GitHub-Sync ist in diesem Arbeitsmodus nicht verfügbar.");
      return;
    }

    const openCommentTaskIds = new Set(data.taskComments
      .filter((comment) => comment.githubDeliveryStatus !== "delivered")
      .map((comment) => comment.taskId));
    const failedCommentTaskIds = new Set(data.taskComments
      .filter((comment) => comment.githubDeliveryStatus === "failed")
      .map((comment) => comment.taskId));
    const queueTasks = githubBulkSyncTasks({
      tasks: data.tasks,
      openCommentTaskIds,
      failedCommentTaskIds,
      onlyFailed: options.onlyFailed,
    });

    if (!queueTasks.length) return;

    const previousSyncStates = new Map(queueTasks.map((task) => [task.id, {
      githubIssueSyncStatus: task.githubIssueSyncStatus,
      githubIssueSyncError: task.githubIssueSyncError,
      githubIssueSyncPendingSince: task.githubIssueSyncPendingSince,
    }]));
    const failedParentTaskIds = new Set<string>();
    const bulkStartedAt = new Date().toISOString();
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((item) => queueTasks.some((task) => task.id === item.id) ? {
        ...item,
        githubIssueSyncStatus: "pending",
        githubIssueSyncError: "",
        githubIssueSyncPendingSince: bulkStartedAt,
      } : item),
    }));

    startTransition(async () => {
      const commentDelivery = {
        delivered: 0,
        waitingForAuthorConnection: 0,
        waitingForIssue: 0,
        retryScheduled: 0,
        failed: 0,
      };
      for (const task of queueTasks) {
        if (task.taskType === "sub_issue" && failedParentTaskIds.has(task.parentTaskId)) {
          const previousSyncState = previousSyncStates.get(task.id);
          setData((current) => ({
            ...current,
            tasks: current.tasks.map((item) => (
              item.id === task.id
              && item.githubIssueSyncStatus === "pending"
              && item.githubIssueSyncPendingSince === bulkStartedAt
              && previousSyncState
                ? { ...item, ...previousSyncState }
                : item
            )),
          }));
          continue;
        }
        const syncStartedAt = new Date().toISOString();
        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, githubIssueSyncPendingSince: syncStartedAt } : item)),
        }));
        let serverTaskPatch: Partial<Task> | undefined;
        try {
          const { response, body } = await taskApi.syncTaskToGitHubRequest(apiClient, task.id, { createIfMissing: !hasGitHubIssue(task) });
          const classification = classifyTaskGitHubSyncResponse(response.status, body);
          serverTaskPatch = classification.result.task;
          rememberTaskServerRevision(serverUpdatedAtByTask, task.id, classification.result.task?.updatedAt);
          if (classification.kind === "locked") {
            setData((current) => ({
              ...current,
              tasks: current.tasks.map((item) => (item.id === task.id ? {
                ...item,
                ...serverTaskPatch,
                githubIssueSyncStatus: "pending",
                githubIssueSyncError: classification.result.error || syncLockedMessage,
                githubIssueSyncPendingSince: syncStartedAt,
              } : item)),
            }));
            if (task.taskType === "deliverable") failedParentTaskIds.add(task.id);
            continue;
          }
          if (classification.kind === "retryable") {
            const retryableMessage = classification.result.error;
            setData((current) => ({
              ...current,
              tasks: current.tasks.map((item) => (item.id === task.id ? {
                ...item,
                ...classification.result.task,
                githubIssueSyncStatus: classification.taskStatus,
                githubIssueSyncError: retryableMessage,
                githubIssueSyncPendingSince: "",
              } : item)),
            }));
            if (task.taskType === "deliverable") failedParentTaskIds.add(task.id);
            setSaveError(retryableMessage);
            continue;
          }
          if (classification.kind === "failure") throw new Error(classification.result.error);
          const success = classification.result;

          setData((current) => ({
            ...current,
            tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...success.task, githubIssueSyncPendingSince: "" } : item)),
          }));
          commentDelivery.delivered += Number(success.commentDelivery.delivered || 0);
          commentDelivery.waitingForAuthorConnection += Number(success.commentDelivery.waitingForAuthorConnection || 0);
          commentDelivery.waitingForIssue += Number(success.commentDelivery.waitingForIssue || 0);
          commentDelivery.retryScheduled += Number(success.commentDelivery.retryScheduled || 0);
          commentDelivery.failed += Number(success.commentDelivery.failed || 0);
        } catch (error) {
          const message = error instanceof Error ? error.message : "GitHub-Sync konnte nicht ausgeführt werden.";
          setData((current) => ({
            ...current,
            tasks: current.tasks.map((item) => (item.id === task.id ? {
              ...item,
              ...serverTaskPatch,
              githubIssueSyncStatus: "failed",
              githubIssueSyncError: message,
              githubIssueSyncPendingSince: "",
            } : item)),
          }));
          if (task.taskType === "deliverable") failedParentTaskIds.add(task.id);
          setSaveError(message);
        }
      }
      const commentParts = [
        commentDelivery.delivered ? `${commentDelivery.delivered} zugestellt` : "",
        commentDelivery.waitingForAuthorConnection ? `${commentDelivery.waitingForAuthorConnection} warten auf die Verbindung ihrer Autoren` : "",
        commentDelivery.waitingForIssue ? `${commentDelivery.waitingForIssue} warten auf ein Issue` : "",
        commentDelivery.retryScheduled ? `${commentDelivery.retryScheduled} für erneuten Versuch eingeplant` : "",
        commentDelivery.failed ? `${commentDelivery.failed} technisch fehlgeschlagen` : "",
      ].filter(Boolean);
      if (commentParts.length) setGithubSyncNotice(`Issues synchronisiert · Kommentare: ${commentParts.join(" · ")}.`);
    });
  };

  return { githubSyncNotice, syncLinkedGitHubTasks, syncTaskToGitHub };
}
