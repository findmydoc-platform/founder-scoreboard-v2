"use client";

import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as taskApi from "@/features/tasks/model/task-api-client";
import { hasGitHubIssue } from "@/lib/platform";
import type { Task } from "@/lib/types";

type UseTaskGitHubSyncCommandOptions = Pick<
  PlanningCommandContext,
  "apiClient" | "data" | "setData" | "setSaveError" | "source" | "startTransition"
>;

const syncLockedMessage = "GitHub-Sync läuft bereits.";

export function useTaskGitHubSyncCommand({
  apiClient,
  data,
  setData,
  setSaveError,
  source,
  startTransition,
}: UseTaskGitHubSyncCommandOptions) {
  const syncTaskToGitHub = (task: Task, options: { createIfMissing?: boolean; silent?: boolean } = {}) => {
    if (!options.silent) setSaveError("");

    const previousTask = task;
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, githubSyncStatus: "pending", githubSyncError: "" } : item)),
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
            tasks: current.tasks.map((item) => (item.id === task.id ? { ...previousTask, githubSyncStatus: "pending", githubSyncError: body.error || syncLockedMessage } : item)),
          }));
          if (!options.silent) setSaveError(body.error || syncLockedMessage);
          return;
        }
        if (!response.ok || !body?.task) throw new Error(body?.error || "GitHub-Sync konnte nicht ausgeführt werden.");

        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...body.task } : item)),
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "GitHub-Sync konnte nicht ausgeführt werden.";
        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? { ...previousTask, githubSyncStatus: "failed", githubSyncError: message } : item)),
        }));
        if (!options.silent) setSaveError(message);
      }
    });
  };

  const syncLinkedGitHubTasks = (options: { onlyFailed?: boolean } = {}) => {
    setSaveError("");

    if (source !== "supabase") {
      setSaveError("GitHub-Sync ist in diesem Arbeitsmodus nicht verfügbar.");
      return;
    }

    const queueTasks = data.tasks.filter((task) =>
      task.taskType === "deliverable" &&
      hasGitHubIssue(task) &&
      task.githubSyncStatus !== "synced" &&
      (!options.onlyFailed || task.githubSyncStatus === "failed")
    );

    if (!queueTasks.length) return;

    const previousTasks = new Map(queueTasks.map((task) => [task.id, task]));
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((item) => queueTasks.some((task) => task.id === item.id) ? { ...item, githubSyncStatus: "pending", githubSyncError: "" } : item),
    }));

    startTransition(async () => {
      for (const task of queueTasks) {
        try {
          const { response, body } = await taskApi.syncTaskToGitHubRequest(apiClient, task.id, { createIfMissing: false });
          if (response.status === 409 && body?.code === "github_sync_locked") {
            const previousTask = previousTasks.get(task.id) || task;
            setData((current) => ({
              ...current,
              tasks: current.tasks.map((item) => (item.id === task.id ? { ...previousTask, githubSyncStatus: "pending", githubSyncError: body.error || syncLockedMessage } : item)),
            }));
            continue;
          }
          if (!response.ok || !body?.task) throw new Error(body?.error || "GitHub-Sync konnte nicht ausgeführt werden.");

          setData((current) => ({
            ...current,
            tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...body.task } : item)),
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : "GitHub-Sync konnte nicht ausgeführt werden.";
          const previousTask = previousTasks.get(task.id) || task;
          setData((current) => ({
            ...current,
            tasks: current.tasks.map((item) => (item.id === task.id ? { ...previousTask, githubSyncStatus: "failed", githubSyncError: message } : item)),
          }));
          setSaveError(message);
        }
      }
    });
  };

  return { syncLinkedGitHubTasks, syncTaskToGitHub };
}
