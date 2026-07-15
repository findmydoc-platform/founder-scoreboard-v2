"use client";

import type { Dispatch, SetStateAction } from "react";
import type { InitiativeDraft } from "@/features/projects/organisms/initiative-dialog";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as planningApi from "@/features/planning/model/planning-api-client";
import { applyOptimisticApprovalDecision } from "@/features/planning/model/approval-domain";
import { canWithdrawPlanningRoot } from "@/features/planning/model/planning-trash-contract";
import { removePlanningRootFromData } from "@/features/planning/model/planning-trash-state";
import type { ApprovalDecisionAction, Package } from "@/lib/types";

type UseInitiativeCommandsOptions = PlanningCommandContext & {
  setInitiativeDialogDefaults: Dispatch<SetStateAction<Partial<InitiativeDraft> | null>>;
};

export function useInitiativeCommands({
  apiClient,
  currentProfile,
  data,
  setData,
  setInitiativeDialogDefaults,
  setSaveError,
  source,
  startTransition,
}: UseInitiativeCommandsOptions) {
  const saveInitiative = (draft: InitiativeDraft) => {
    setSaveError("");

    const localInitiative: Package = {
      id: draft.id || `local-initiative-${Date.now()}`,
      milestoneId: draft.milestoneId,
      ownerId: draft.ownerId,
      accountableProfileId: draft.accountableProfileId,
      responsibleProfileIds: draft.responsibleProfileIds,
      consultedProfileIds: draft.consultedProfileIds,
      informedProfileIds: draft.informedProfileIds,
      title: draft.title,
      goal: draft.goal,
      priority: draft.priority || "P2",
      status: draft.status || "planned",
      targetDate: draft.targetDate,
      successCriteria: draft.successCriteria,
      scopeConstraints: draft.scopeConstraints,
      sortOrder: draft.id ? data.packages.find((pack) => pack.id === draft.id)?.sortOrder || data.packages.length + 1 : data.packages.length + 1,
      approvalStatus: draft.id ? data.packages.find((pack) => pack.id === draft.id)?.approvalStatus || "approved" : draft.approveNow ? "approved" : "proposed",
      approvalRevision: draft.id ? data.packages.find((pack) => pack.id === draft.id)?.approvalRevision || 1 : 1,
    };
    const isEdit = Boolean(draft.id);

    if (source !== "supabase" || isEdit) {
      setData((current) => ({
        ...current,
        packages: isEdit
          ? current.packages.map((pack) => (pack.id === draft.id ? { ...pack, ...localInitiative } : pack))
          : [...current.packages, localInitiative],
      }));
      setInitiativeDialogDefaults(null);
    }

    if (source !== "supabase") return;

    if (!isEdit) {
      return new Promise<void>((resolve, reject) => {
        startTransition(async () => {
          try {
            const { response, body } = await planningApi.saveInitiativeRequest(apiClient, draft);
            if (!response.ok || !body?.initiative) throw new Error(body?.error || "Initiative konnte nicht gespeichert werden.");

            setData((current) => ({
              ...current,
              packages: [...current.packages, body.initiative!],
            }));
            setInitiativeDialogDefaults(null);
            resolve();
          } catch (error) {
            const failure = error instanceof Error ? error : new Error("Initiative konnte nicht gespeichert werden.");
            setSaveError(failure.message);
            reject(failure);
          }
        });
      });
    }

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.saveInitiativeRequest(apiClient, draft);
        if (!response.ok || !body?.initiative) throw new Error(body?.error || "Initiative konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          packages: current.packages.map((pack) => (pack.id === draft.id ? body.initiative! : pack)),
        }));
      } catch (error) {
        setData((current) => ({
          ...current,
          packages: current.packages.map((pack) => (pack.id === draft.id ? data.packages.find((original) => original.id === draft.id) || pack : pack)),
        }));
        setSaveError(error instanceof Error ? error.message : "Initiative konnte nicht gespeichert werden.");
      }
    });
  };

  const decideInitiativeApproval = (initiative: Package, action: ApprovalDecisionAction, note = "") => {
    setSaveError("");
    if (source !== "supabase") {
      setData((current) => action === "reject"
        ? removePlanningRootFromData(current, "initiative", initiative.id).data
        : {
            ...current,
            packages: current.packages.map((pack) => pack.id === initiative.id
              ? applyOptimisticApprovalDecision(pack, action, note)
              : pack),
          });
      return;
    }
    startTransition(async () => {
      try {
        const { response, body } = await planningApi.decideInitiativeApprovalRequest(apiClient, initiative.id, action, initiative.approvalRevision, note);
        if (!response.ok || !body?.initiative) throw new Error(body?.error || "Freigabeentscheidung konnte nicht gespeichert werden.");
        setData((current) => action === "reject"
          ? removePlanningRootFromData(current, "initiative", initiative.id).data
          : {
              ...current,
              packages: current.packages.map((pack) => pack.id === initiative.id ? body.initiative! : pack),
            });
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Freigabeentscheidung konnte nicht gespeichert werden.");
      }
    });
  };

  const withdrawInitiative = (initiative: Package, reason: string) => {
    const canWithdraw = canWithdrawPlanningRoot({
      rootType: "initiative",
      approvalStatus: initiative.approvalStatus,
      proposedById: initiative.proposedById,
    }, currentProfile, source === "seed");
    if (!canWithdraw) {
      setSaveError("Nur Antragsteller, CEO oder Deputy können vorgeschlagene Initiativen zurückziehen.");
      return;
    }
    setSaveError("");
    if (source !== "supabase") {
      setData((current) => removePlanningRootFromData(current, "initiative", initiative.id).data);
      return;
    }
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
