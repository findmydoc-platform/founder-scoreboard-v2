"use client";

import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as taskApi from "@/features/tasks/model/task-api-client";
import { hasGitHubIssue } from "@/lib/platform";
import type { Task } from "@/lib/types";

type UseTaskDeleteCommandOptions = Pick<
  PlanningCommandContext,
  "apiClient" | "canManageTaskMeta" | "data" | "setData" | "setSaveError" | "source" | "startTransition"
> & {
  closeTaskPanel: () => void;
};

export function useTaskDeleteCommand({
  apiClient,
  canManageTaskMeta,
  closeTaskPanel,
  data,
  setData,
  setSaveError,
  source,
  startTransition,
}: UseTaskDeleteCommandOptions) {
  const deleteTask = (task: Task) => {
    if (!canManageTaskMeta) {
      setSaveError("Nur CEO oder Deputy können Aufgaben löschen.");
      return;
    }
    const confirmed = window.confirm(
      hasGitHubIssue(task)
        ? "Aufgabe aus der App löschen und die externe Ablage schließen?"
        : "Aufgabe aus der App löschen?",
    );
    if (!confirmed) return;

    setSaveError("");
    const previousTask = task;
    const previousRelations = data.taskRelations;
    const previousComments = data.taskComments;
    const previousActivity = data.taskActivity;

    setData((current) => ({
      ...current,
      tasks: current.tasks.filter((item) => item.id !== task.id && item.parentTaskId !== task.id),
      taskRelations: current.taskRelations.filter((relation) => relation.taskId !== task.id && relation.relatedTaskId !== task.id),
      taskComments: current.taskComments.filter((comment) => comment.taskId !== task.id),
      taskActivity: current.taskActivity.filter((activity) => activity.taskId !== task.id),
    }));
    closeTaskPanel();

    if (source !== "supabase") return;

    startTransition(async () => {
      try {
        const { response, body } = await taskApi.deleteTaskRequest(apiClient, task.id);
        if (!response.ok) throw new Error(body?.error || "Aufgabe konnte nicht gelöscht werden.");
      } catch (error) {
        setData((current) => ({
          ...current,
          tasks: [previousTask, ...current.tasks],
          taskRelations: previousRelations,
          taskComments: previousComments,
          taskActivity: previousActivity,
        }));
        setSaveError(error instanceof Error ? error.message : "Aufgabe konnte nicht gelöscht werden.");
      }
    });
  };

  return { deleteTask };
}
