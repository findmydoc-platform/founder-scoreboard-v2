"use client";

import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import { canWithdrawPlanningRoot } from "@/features/planning/model/planning-trash-contract";
import type { Task } from "@/lib/types";

type UseTaskWithdrawCommandOptions = Pick<PlanningCommandContext, "planningState" | "currentProfile" | "setSaveError" | "startTransition"> & { closeTaskPanel: () => void };

export function useTaskWithdrawCommand({ planningState, closeTaskPanel, currentProfile, setSaveError, startTransition }: UseTaskWithdrawCommandOptions) {
  const withdrawTask = (task: Task, reason: string) => {
    if (task.taskType !== "deliverable" || !canWithdrawPlanningRoot({ rootType: "deliverable", approvalStatus: task.approvalStatus, proposedById: task.proposedById }, currentProfile, false)) {
      setSaveError("Nur Antragsteller, CEO oder Deputy können vorgeschlagene Deliverables zurückziehen.");
      return false;
    }
    setSaveError("");
    const result = planningState.withdrawTask(task, reason);
    closeTaskPanel();
    startTransition(async () => {
      const outcome = await result;
      if (!outcome.ok) setSaveError(outcome.error);
    });
    return true;
  };
  return { withdrawTask };
}
