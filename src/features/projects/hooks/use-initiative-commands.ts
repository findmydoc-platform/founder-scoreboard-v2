"use client";

import type { Dispatch, SetStateAction } from "react";
import type { InitiativeDraft } from "@/features/projects/organisms/initiative-dialog";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as planningApi from "@/features/planning/model/planning-api-client";
import type { Package } from "@/lib/types";

type UseInitiativeCommandsOptions = PlanningCommandContext & {
  setInitiativeDialogDefaults: Dispatch<SetStateAction<Partial<InitiativeDraft> | null>>;
};

export function useInitiativeCommands({
  apiClient,
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
    };
    const isEdit = Boolean(draft.id);

    setData((current) => ({
      ...current,
      packages: isEdit
        ? current.packages.map((pack) => (pack.id === draft.id ? { ...pack, ...localInitiative } : pack))
        : [...current.packages, localInitiative],
    }));
    setInitiativeDialogDefaults(null);

    if (source !== "supabase") return;

    startTransition(async () => {
      try {
        const { response, body } = await planningApi.saveInitiativeRequest(apiClient, draft);
        if (!response.ok || !body?.initiative) throw new Error(body?.error || "Initiative konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          packages: isEdit
            ? current.packages.map((pack) => (pack.id === draft.id ? body.initiative! : pack))
            : current.packages.map((pack) => (pack.id === localInitiative.id ? body.initiative! : pack)),
        }));
      } catch (error) {
        setData((current) => ({
          ...current,
          packages: isEdit
            ? current.packages.map((pack) => (pack.id === draft.id ? data.packages.find((original) => original.id === draft.id) || pack : pack))
            : current.packages.filter((pack) => pack.id !== localInitiative.id),
        }));
        setSaveError(error instanceof Error ? error.message : "Initiative konnte nicht gespeichert werden.");
      }
    });
  };

  return { saveInitiative };
}
