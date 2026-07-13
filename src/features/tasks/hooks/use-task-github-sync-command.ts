"use client";

import { useState } from "react";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import { githubBulkSyncTasks } from "@/features/tasks/model/github-sync-queue";
import * as taskApi from "@/features/tasks/model/task-api-client";
import { githubSyncStatePersistFailedMessage } from "@/lib/github-sync-failure-persistence";
import { hasGitHubIssue } from "@/lib/platform";
import type { Task } from "@/lib/types";

type UseTaskGitHubSyncCommandOptions = Pick<
  PlanningCommandContext,
  "apiClient" | "data" | "setData" | "setSaveError" | "source" | "startTransition"
>;

const syncLockedMessage = "GitHub-Sync läuft bereits.";
const syncStaleMessage = "Die Aufgabe wurde während des GitHub-Syncs geändert. Bitte prüfe den aktuellen Stand und starte den Sync erneut.";

function retryableGitHubSyncMessage(status: number, code?: string, serverMessage?: string) {
  if (status === 409 && code === "github_sync_stale") return serverMessage || syncStaleMessage;
  if (status === 503 && code === "github_sync_state_persist_failed") return serverMessage || githubSyncStatePersistFailedMessage;
  return "";
}

export function useTaskGitHubSyncCommand({
  apiClient,
  data,
  setData,
  setSaveError,
  source,
  startTransition,
}: UseTaskGitHubSyncCommandOptions) {
  const [githubSyncNotice, setGithubSyncNotice] = useState("");
  const syncTaskToGitHub = (task: Task, options: { createIfMissing?: boolean; silent?: boolean } = {}) => {
    if (!options.silent) {
      setSaveError("");
      setGithubSyncNotice("");
    }

    const previousTask = task;
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
        tasks: current.tasks.map((item) => (item.id === task.id ? previousTask : item)),
      }));
      return;
    }

    startTransition(async () => {
      try {
        const { response, body } = await taskApi.syncTaskToGitHubRequest(apiClient, task.id, { createIfMissing: Boolean(options.createIfMissing) });
        if (response.status === 409 && body?.code === "github_sync_locked") {
          setData((current) => ({
            ...current,
            tasks: current.tasks.map((item) => (item.id === task.id ? {
              ...previousTask,
              githubIssueSyncStatus: "pending",
              githubIssueSyncError: body.error || syncLockedMessage,
              githubIssueSyncPendingSince: syncStartedAt,
            } : item)),
          }));
          if (!options.silent) setSaveError(body.error || syncLockedMessage);
          return;
        }
        const retryableMessage = retryableGitHubSyncMessage(response.status, body?.code, body?.error);
        if (retryableMessage) {
          setData((current) => ({
            ...current,
            tasks: current.tasks.map((item) => (item.id === task.id ? {
              ...previousTask,
              githubIssueSyncStatus: "not_synced",
              githubIssueSyncError: retryableMessage,
              githubIssueSyncPendingSince: "",
            } : item)),
          }));
          if (!options.silent) setSaveError(retryableMessage);
          return;
        }
        if (!response.ok || !body?.task) throw new Error(body?.error || "GitHub-Sync konnte nicht ausgeführt werden.");

        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...body.task, githubIssueSyncPendingSince: "" } : item)),
        }));
        if (!options.silent) setGithubSyncNotice(body.notices?.[0]?.message || "");
      } catch (error) {
        const message = error instanceof Error ? error.message : "GitHub-Sync konnte nicht ausgeführt werden.";
        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? {
            ...previousTask,
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

    const previousTasks = new Map(queueTasks.map((task) => [task.id, task]));
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
          const previousTask = previousTasks.get(task.id) || task;
          setData((current) => ({
            ...current,
            tasks: current.tasks.map((item) => (item.id === task.id ? previousTask : item)),
          }));
          continue;
        }
        const syncStartedAt = new Date().toISOString();
        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, githubIssueSyncPendingSince: syncStartedAt } : item)),
        }));
        try {
          const { response, body } = await taskApi.syncTaskToGitHubRequest(apiClient, task.id, { createIfMissing: !hasGitHubIssue(task) });
          if (response.status === 409 && body?.code === "github_sync_locked") {
            const previousTask = previousTasks.get(task.id) || task;
            setData((current) => ({
              ...current,
              tasks: current.tasks.map((item) => (item.id === task.id ? {
                ...previousTask,
                githubIssueSyncStatus: "pending",
                githubIssueSyncError: body.error || syncLockedMessage,
                githubIssueSyncPendingSince: syncStartedAt,
              } : item)),
            }));
            if (task.taskType === "deliverable") failedParentTaskIds.add(task.id);
            continue;
          }
          const retryableMessage = retryableGitHubSyncMessage(response.status, body?.code, body?.error);
          if (retryableMessage) {
            const previousTask = previousTasks.get(task.id) || task;
            setData((current) => ({
              ...current,
              tasks: current.tasks.map((item) => (item.id === task.id ? {
                ...previousTask,
                githubIssueSyncStatus: "not_synced",
                githubIssueSyncError: retryableMessage,
                githubIssueSyncPendingSince: "",
              } : item)),
            }));
            if (task.taskType === "deliverable") failedParentTaskIds.add(task.id);
            setSaveError(retryableMessage);
            continue;
          }
          if (!response.ok || !body?.task) throw new Error(body?.error || "GitHub-Sync konnte nicht ausgeführt werden.");

          setData((current) => ({
            ...current,
            tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...body.task, githubIssueSyncPendingSince: "" } : item)),
          }));
          commentDelivery.delivered += Number(body.commentDelivery?.delivered || 0);
          commentDelivery.waitingForAuthorConnection += Number(body.commentDelivery?.waitingForAuthorConnection || 0);
          commentDelivery.waitingForIssue += Number(body.commentDelivery?.waitingForIssue || 0);
          commentDelivery.retryScheduled += Number(body.commentDelivery?.retryScheduled || 0);
          commentDelivery.failed += Number(body.commentDelivery?.failed || 0);
        } catch (error) {
          const message = error instanceof Error ? error.message : "GitHub-Sync konnte nicht ausgeführt werden.";
          const previousTask = previousTasks.get(task.id) || task;
          setData((current) => ({
            ...current,
            tasks: current.tasks.map((item) => (item.id === task.id ? {
              ...previousTask,
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
