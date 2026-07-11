"use client";

import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import { persistLocalPlanningTasks } from "@/features/planning/hooks/use-local-planning-state";
import * as taskApi from "@/features/tasks/model/task-api-client";
import {
  removeTaskTreeFromPlanningData,
  restoreTaskTreeToPlanningData,
} from "@/features/tasks/model/task-deletion-state";
import { hasGitHubIssue } from "@/lib/platform";
import type { Task } from "@/lib/types";

type UseTaskDeleteCommandOptions = Pick<
  PlanningCommandContext,
  | "apiClient"
  | "applyPlanningDataUpdate"
  | "canManageTaskMeta"
  | "data"
  | "setSaveError"
  | "source"
  | "startTransition"
> & {
  closeTaskPanel: () => void;
  refreshPlanningData: () => Promise<void>;
};

export function useTaskDeleteCommand({
  apiClient,
  applyPlanningDataUpdate,
  canManageTaskMeta,
  closeTaskPanel,
  data,
  refreshPlanningData,
  setSaveError,
  source,
  startTransition,
}: UseTaskDeleteCommandOptions) {
  const deleteTask = (task: Task) => {
    if (!canManageTaskMeta) {
      setSaveError("Nur CEO oder Deputy können Aufgaben löschen.");
      return;
    }
    const deletion = removeTaskTreeFromPlanningData(data, task.id);
    const hasLinkedGitHubIssue = deletion.snapshot.tasks.some(hasGitHubIssue);
    const confirmed = window.confirm(
      hasLinkedGitHubIssue
        ? "Aufgabe und vorhandene Unteraufgaben aus der App löschen und alle verknüpften externen Ablagen schließen?"
        : "Aufgabe und vorhandene Unteraufgaben aus der App löschen?",
    );
    if (!confirmed) return;

    setSaveError("");

    applyPlanningDataUpdate((current) => removeTaskTreeFromPlanningData(current, task.id).data);
    closeTaskPanel();

    if (source !== "supabase") {
      try {
        persistLocalPlanningTasks(deletion.data.tasks);
      } catch {
        // Local development remains usable when browser storage is unavailable.
      }
      return;
    }

    startTransition(async () => {
      try {
        const { response, body } = await taskApi.deleteTaskRequest(apiClient, task.id, task.updatedAt || "");
        if (!response.ok) throw new Error(body?.error || "Aufgabe konnte nicht gelöscht werden.");
      } catch (error) {
        applyPlanningDataUpdate((current) => restoreTaskTreeToPlanningData(current, deletion.snapshot));
        await refreshPlanningData();
        setSaveError(error instanceof Error ? error.message : "Aufgabe konnte nicht gelöscht werden.");
      }
    });
  };

  return { deleteTask };
}
