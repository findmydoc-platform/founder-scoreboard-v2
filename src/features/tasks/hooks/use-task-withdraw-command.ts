"use client";

import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import { canWithdrawPlanningRoot } from "@/features/planning/model/planning-trash-contract";
import {
  removePlanningRootFromData,
  restorePlanningRootToData,
} from "@/features/planning/model/planning-trash-state";
import { persistLocalPlanningTasks } from "@/features/planning/hooks/use-local-planning-state";
import * as taskApi from "@/features/tasks/model/task-api-client";
import type { Task } from "@/lib/types";

type UseTaskWithdrawCommandOptions = Pick<
  PlanningCommandContext,
  | "apiClient"
  | "applyPlanningDataUpdate"
  | "currentProfile"
  | "data"
  | "setSaveError"
  | "source"
  | "startTransition"
> & {
  closeTaskPanel: () => void;
  refreshPlanningData: () => Promise<void>;
};

export function useTaskWithdrawCommand({
  apiClient,
  applyPlanningDataUpdate,
  closeTaskPanel,
  currentProfile,
  data,
  refreshPlanningData,
  setSaveError,
  source,
  startTransition,
}: UseTaskWithdrawCommandOptions) {
  const withdrawTask = (task: Task, reason: string) => {
    const canWithdraw = task.taskType === "deliverable" && canWithdrawPlanningRoot({
      rootType: "deliverable",
      approvalStatus: task.approvalStatus,
      proposedById: task.proposedById,
    }, currentProfile, source === "seed");
    if (!canWithdraw) {
      setSaveError("Nur Antragsteller, CEO oder Deputy können vorgeschlagene Deliverables zurückziehen.");
      return false;
    }

    const withdrawal = removePlanningRootFromData(data, "deliverable", task.id);
    setSaveError("");
    applyPlanningDataUpdate((current) => removePlanningRootFromData(current, "deliverable", task.id).data);
    closeTaskPanel();

    if (source !== "supabase") {
      try {
        persistLocalPlanningTasks(withdrawal.data.tasks);
      } catch {
        // Local development remains usable when browser storage is unavailable.
      }
      return true;
    }

    startTransition(async () => {
      try {
        const { response, body } = await taskApi.withdrawTaskRequest(apiClient, task.id, task.approvalRevision, reason);
        if (!response.ok) throw new Error(body?.error || "Deliverable konnte nicht zurückgezogen werden.");
      } catch (error) {
        applyPlanningDataUpdate((current) => restorePlanningRootToData(current, withdrawal.snapshot));
        await refreshPlanningData();
        setSaveError(error instanceof Error ? error.message : "Deliverable konnte nicht zurückgezogen werden.");
      }
    });
    return true;
  };

  return { withdrawTask };
}
