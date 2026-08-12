"use client";

import type { Dispatch, SetStateAction } from "react";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as planningApi from "@/features/planning/model/planning-api-client";
import type { MilestoneDeleteTarget } from "@/features/projects/organisms/milestone-delete-dialog";
import type { MilestoneDraft } from "@/features/projects/organisms/milestone-dialog";
import type { Task } from "@/lib/types";

type UseMilestoneCommandsOptions = PlanningCommandContext & {
  setMilestoneDeleteTarget: Dispatch<SetStateAction<MilestoneDeleteTarget | null>>;
  setMilestoneDialogDefaults: Dispatch<SetStateAction<Partial<MilestoneDraft> | null>>;
};

function responseError(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return fallback;
}

export function useMilestoneCommands({
  apiClient,
  applyPlanningShellStateUpdate,
  setMilestoneDeleteTarget,
  setMilestoneDialogDefaults,
}: UseMilestoneCommandsOptions) {
  const saveMilestone = async (draft: MilestoneDraft) => {
    const { response, body } = await planningApi.saveMilestoneRequest(apiClient, draft);
    if (!response.ok || !body || !("task" in body) || !body.task) {
      throw new Error(responseError(body, "Der Meilenstein konnte nicht gespeichert werden."));
    }
    const epic = body.task;
    applyPlanningShellStateUpdate((current) => ({
      ...current,
      tasks: current.tasks.some((item) => item.id === epic.id)
        ? current.tasks.map((item) => item.id === epic.id ? epic : item)
        : [...current.tasks, epic],
    }));
    setMilestoneDialogDefaults(null);
  };

  const deleteMilestone = async (milestone: Task) => {
    const { response, body } = await planningApi.deleteMilestoneRequest(apiClient, milestone.id, {
      expectedUpdatedAt: milestone.updatedAt || "",
    });
    if (!response.ok) throw new Error(responseError(body, "Der Meilenstein konnte nicht gelöscht werden."));
    applyPlanningShellStateUpdate((current) => ({
      ...current,
      tasks: current.tasks.filter((item) => item.id !== milestone.id),
    }));
    setMilestoneDeleteTarget(null);
  };

  return { deleteMilestone, saveMilestone };
}
