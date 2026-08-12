"use client";

import type { Dispatch, SetStateAction } from "react";
import type { InitiativeDraft } from "@/features/projects/organisms/initiative-dialog";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as planningApi from "@/features/planning/model/planning-api-client";
import { canWithdrawPlanningRoot } from "@/features/planning/model/planning-trash-contract";
import { removePlanningRootFromData } from "@/features/planning/model/planning-trash-state";
import type { ApprovalDecisionAction, Task } from "@/lib/types";

type UseInitiativeCommandsOptions = PlanningCommandContext & {
  setInitiativeDialogDefaults: Dispatch<SetStateAction<Partial<InitiativeDraft> | null>>;
};

function replacePlanningItem(items: Task[], replacement: Task) {
  return items.some((item) => item.id === replacement.id)
    ? items.map((item) => item.id === replacement.id ? replacement : item)
    : [...items, replacement];
}

export function useInitiativeCommands({
  apiClient,
  currentProfile,
  setData,
  setInitiativeDialogDefaults,
  setSaveError,
  startTransition,
}: UseInitiativeCommandsOptions) {
  const saveInitiative = (draft: InitiativeDraft) => {
    setSaveError("");
    return new Promise<void>((resolve, reject) => {
      startTransition(async () => {
        try {
          const { response, body } = await planningApi.saveInitiativeRequest(apiClient, draft);
          if (!response.ok || !body?.task) throw new Error(body?.error || "Initiative konnte nicht gespeichert werden.");
          setData((current) => ({ ...current, tasks: replacePlanningItem(current.tasks, body.task!) }));
          setInitiativeDialogDefaults(null);
          resolve();
        } catch (error) {
          const failure = error instanceof Error ? error : new Error("Initiative konnte nicht gespeichert werden.");
          setSaveError(failure.message);
          reject(failure);
        }
      });
    });
  };

  const decideInitiativeApproval = (initiative: Task, action: ApprovalDecisionAction, note = "") => {
    setSaveError("");
    startTransition(async () => {
      try {
        const { response, body } = await planningApi.decideInitiativeApprovalRequest(apiClient, initiative.id, action, initiative.approvalRevision, note);
        if (!response.ok || !body?.task) throw new Error(body?.error || "Freigabeentscheidung konnte nicht gespeichert werden.");
        setData((current) => action === "reject"
          ? removePlanningRootFromData(current, "initiative", initiative.id).data
          : { ...current, tasks: replacePlanningItem(current.tasks, body.task!) });
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Freigabeentscheidung konnte nicht gespeichert werden.");
      }
    });
  };

  const withdrawInitiative = (initiative: Task, reason: string) => {
    const canWithdraw = canWithdrawPlanningRoot({
      rootType: "initiative",
      approvalStatus: initiative.approvalStatus,
      proposedById: initiative.proposedById,
    }, currentProfile, false);
    if (!canWithdraw) {
      setSaveError("Nur Antragsteller, CEO oder Deputy können vorgeschlagene Initiativen zurückziehen.");
      return;
    }
    setSaveError("");
    startTransition(async () => {
      try {
        const { response, body } = await planningApi.withdrawInitiativeRequest(apiClient, initiative.id, initiative.approvalRevision, reason);
        if (!response.ok) throw new Error(body?.error || "Initiative konnte nicht zurückgezogen werden.");
        setData((current) => removePlanningRootFromData(current, "initiative", initiative.id).data);
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Initiative konnte nicht zurückgezogen werden.");
      }
    });
  };

  return { decideInitiativeApproval, saveInitiative, withdrawInitiative };
}
