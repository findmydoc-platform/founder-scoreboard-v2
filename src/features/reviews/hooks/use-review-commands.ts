"use client";

import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import { persistLocalPlanningTasks } from "@/features/planning/hooks/use-local-planning-state";
import * as taskApi from "@/features/tasks/model/task-api-client";
import { hasGitHubIssue } from "@/lib/platform";
import { reviewDecisionTaskState } from "@/features/reviews/model/task-review-state";
import type { Task, TaskReviewChecklist } from "@/lib/types";

type TaskSyncCommand = (task: Task, options?: { createIfMissing?: boolean; silent?: boolean }) => void;

export function useReviewCommands({
  apiClient,
  githubInstallationAvailable,
  setData,
  setSaveError,
  source,
  startTransition,
  syncTaskToGitHub,
}: PlanningCommandContext & { syncTaskToGitHub: TaskSyncCommand }) {
  const updateReviewTasks = (update: (tasks: Task[]) => Task[]) => {
    setData((current) => {
      const tasks = update(current.tasks);
      if (source === "seed") {
        try {
          persistLocalPlanningTasks(tasks);
        } catch {
          // The local demo stays usable if browser storage is unavailable.
        }
      }
      return { ...current, tasks };
    });
  };

  const reviewTask = (
    task: Task,
    reviewStatus: "accepted" | "partial" | "changes_requested",
    scorePoints: number,
    checklist?: TaskReviewChecklist,
    comment?: string,
  ) => {
    setSaveError("");

    const { status: nextStatus, scoreFinal } = reviewDecisionTaskState(reviewStatus);
    const previousTask = task;

    updateReviewTasks((tasks) =>
      tasks.map((item) =>
        item.id === task.id ? { ...item, status: nextStatus, reviewStatus, scorePoints, scoreFinal, reviewRequestedAt: "" } : item,
      ),
    );

    if (source !== "supabase") return true;

    return new Promise<boolean>((resolve) => startTransition(async () => {
      try {
        const { response, body } = await taskApi.reviewTaskRequest(apiClient, task.id, { decision: reviewStatus, points: scorePoints, checklist, comment });
        if (!response.ok || !body?.task || !body.review) throw new Error(body?.error || "Review konnte nicht gespeichert werden.");
        const savedTask = body.task;
        const savedReview = body.review;
        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...savedTask } : item)),
          taskReviews: [savedReview, ...current.taskReviews.filter((review) => review.id !== savedReview.id)],
        }));
        if (hasGitHubIssue(task) && githubInstallationAvailable) {
          syncTaskToGitHub({ ...task, status: nextStatus, reviewStatus, scorePoints, scoreFinal }, { silent: true });
        }
        resolve(true);
      } catch (error) {
        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? previousTask : item)),
        }));
        setSaveError(error instanceof Error ? error.message : "Review konnte nicht gespeichert werden.");
        resolve(false);
      }
    }));
  };

  const withdrawReviewTask = (task: Task, reason: string) => {
    setSaveError("");
    const previousTask = task;
    updateReviewTasks((tasks) =>
      tasks.map((item) => item.id === task.id ? {
        ...item,
        status: "In Arbeit",
        reviewStatus: "not_requested",
        scoreFinal: false,
        scorePoints: 0,
        reviewRequestedAt: "",
      } : item),
    );

    if (source !== "supabase") return true;

    return new Promise<boolean>((resolve) => startTransition(async () => {
      try {
        const { response, body } = await taskApi.withdrawTaskReviewRequest(apiClient, task.id, reason, task.updatedAt || "");
        if (!response.ok || !body?.task) throw new Error(body?.error || "Review konnte nicht zurückgezogen werden.");
        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => item.id === task.id ? { ...item, ...body.task } : item),
        }));
        resolve(true);
      } catch (error) {
        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => item.id === task.id ? previousTask : item),
        }));
        setSaveError(error instanceof Error ? error.message : "Review konnte nicht zurückgezogen werden.");
        resolve(false);
      }
    }));
  };

  const reopenReviewTask = (task: Task) => {
    setSaveError("");
    const previousTask = task;
    const reviewRequestedAt = new Date().toISOString();

    updateReviewTasks((tasks) =>
      tasks.map((item) =>
        item.id === task.id ? { ...item, status: "Review", reviewStatus: "requested", scoreFinal: false, scorePoints: 0, reviewRequestedAt } : item,
      ),
    );

    if (source !== "supabase") return true;

    return new Promise<boolean>((resolve) => startTransition(async () => {
      try {
        const { response, body } = await taskApi.reopenTaskReviewRequest(apiClient, task.id, task.updatedAt || "");
        if (!response.ok || !body?.task) throw new Error(body?.error || "Review konnte nicht wieder geöffnet werden.");
        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...body.task } : item)),
        }));
        resolve(true);
      } catch (error) {
        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? previousTask : item)),
        }));
        setSaveError(error instanceof Error ? error.message : "Review konnte nicht wieder geöffnet werden.");
        resolve(false);
      }
    }));
  };

  return {
    reopenReviewTask,
    reviewTask,
    withdrawReviewTask,
  };
}
