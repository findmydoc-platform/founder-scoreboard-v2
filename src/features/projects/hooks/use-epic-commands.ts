"use client";

import type { Dispatch, SetStateAction } from "react";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as planningApi from "@/features/planning/model/planning-api-client";
import type { EpicDeleteTarget } from "@/features/projects/organisms/epic-delete-dialog";
import type { EpicDraft } from "@/features/projects/organisms/epic-dialog";
import type { Task } from "@/lib/types";

type UseEpicCommandsOptions = PlanningCommandContext & {
  setEpicDeleteTarget: Dispatch<SetStateAction<EpicDeleteTarget | null>>;
  setEpicDialogDefaults: Dispatch<SetStateAction<Partial<EpicDraft> | null>>;
};

function responseError(body: unknown, fallback: string) {
  if (body && typeof body === "object" && "error" in body && typeof body.error === "string") {
    return body.error;
  }
  return fallback;
}

export function useEpicCommands({
  apiClient,
  applyPlanningShellStateUpdate,
  setEpicDeleteTarget,
  setEpicDialogDefaults,
}: UseEpicCommandsOptions) {
  const saveEpic = async (draft: EpicDraft) => {
    const { response, body } = await planningApi.saveEpicRequest(apiClient, draft);
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
    setEpicDialogDefaults(null);
  };

  const deleteEpic = async (epic: Task) => {
    const { response, body } = await planningApi.deleteEpicRequest(apiClient, epic.id, {
      expectedUpdatedAt: epic.updatedAt || "",
    });
    if (!response.ok) throw new Error(responseError(body, "Der Meilenstein konnte nicht gelöscht werden."));
    applyPlanningShellStateUpdate((current) => ({
      ...current,
      tasks: current.tasks.filter((item) => item.id !== epic.id),
    }));
    setEpicDeleteTarget(null);
  };

  return { deleteEpic, saveEpic };
}
