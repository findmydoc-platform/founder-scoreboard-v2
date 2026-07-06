"use client";

import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as taskApi from "@/features/tasks/model/task-api-client";
import { hasGitHubIssue } from "@/lib/platform";
import type { Task } from "@/lib/types";

type TaskSyncCommand = (task: Task, options?: { createIfMissing?: boolean; silent?: boolean }) => void;

export function useReviewCommands({
  apiClient,
  githubAppConnected,
  setData,
  setSaveError,
  source,
  startTransition,
  syncTaskToGitHub,
}: PlanningCommandContext & { syncTaskToGitHub: TaskSyncCommand }) {
  const reviewTask = (
    task: Task,
    reviewStatus: "accepted" | "partial" | "changes_requested",
    scorePoints: number,
    checklist?: { acceptanceCriteriaMet?: boolean; dodMet?: boolean; evidenceProvided?: boolean; communicationClear?: boolean; blockerHandled?: boolean },
    comment?: string,
  ) => {
    setSaveError("");

    const nextStatus = reviewStatus === "accepted" ? "Erledigt" : reviewStatus === "changes_requested" ? "Nacharbeit" : "Review";
    const scoreFinal = reviewStatus !== "changes_requested";
    const previousTask = task;

    setData((current) => ({
      ...current,
      tasks: current.tasks.map((item) =>
        item.id === task.id ? { ...item, status: nextStatus, reviewStatus, scorePoints, scoreFinal, reviewRequestedAt: "" } : item,
      ),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      try {
        const { response, body } = await taskApi.reviewTaskRequest(apiClient, task.id, { decision: reviewStatus, points: scorePoints, checklist, comment });
        if (!response.ok) throw new Error(body?.error || "Review konnte nicht gespeichert werden.");
        if (hasGitHubIssue(task) && githubAppConnected) {
          syncTaskToGitHub({ ...task, status: nextStatus, reviewStatus, scorePoints, scoreFinal }, { silent: true });
        }
      } catch (error) {
        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? previousTask : item)),
        }));
        setSaveError(error instanceof Error ? error.message : "Review konnte nicht gespeichert werden.");
      }
    });
  };

  const reopenReviewTask = (task: Task) => {
    setSaveError("");
    const previousTask = task;
    const reviewRequestedAt = new Date().toISOString();

    setData((current) => ({
      ...current,
      tasks: current.tasks.map((item) =>
        item.id === task.id ? { ...item, status: "Review", reviewStatus: "requested", scoreFinal: false, scorePoints: 0, reviewRequestedAt } : item,
      ),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      try {
        const { response, body } = await taskApi.reopenTaskReviewRequest(apiClient, task.id);
        if (!response.ok || !body?.task) throw new Error(body?.error || "Review konnte nicht wieder geöffnet werden.");
        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...body.task } : item)),
        }));
      } catch (error) {
        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? previousTask : item)),
        }));
        setSaveError(error instanceof Error ? error.message : "Review konnte nicht wieder geöffnet werden.");
      }
    });
  };

  return {
    reopenReviewTask,
    reviewTask,
  };
}
