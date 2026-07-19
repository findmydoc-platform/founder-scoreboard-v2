"use client";

import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import { persistLocalPlanningData } from "@/features/planning/hooks/use-local-planning-state";
import { updateFounderOpsReviewWindowRequest } from "@/features/planning/model/planning-api-client";
import { applyReviewWindowHours } from "@/features/settings/model/founderops-settings-state";

export function useFounderOpsSettingsCommands({
  apiClient,
  applyPlanningDataUpdate,
  currentProfile,
  data,
  setSaveError,
  source,
}: PlanningCommandContext) {
  const saveFounderOpsReviewWindow = async (reviewObjectionWindowHours: number) => {
    if (currentProfile?.platformRole !== "ceo") throw new Error("Nur der CEO kann diese Prozesseinstellung ändern.");

    setSaveError("");
    const expectedHours = data.project.reviewObjectionWindowHours;

    if (source !== "supabase") {
      const localData = applyReviewWindowHours(data, reviewObjectionWindowHours);
      applyPlanningDataUpdate(() => localData);
      persistLocalPlanningData(localData);
      return;
    }

    const { response, body } = await updateFounderOpsReviewWindowRequest(apiClient, expectedHours, reviewObjectionWindowHours);
    if (!response.ok || !body?.project) throw new Error(body?.error || "Prozesseinstellung konnte nicht gespeichert werden.");
    applyPlanningDataUpdate((current) => applyReviewWindowHours(
      current,
      body.project!.reviewObjectionWindowHours,
      body.sprints || [],
    ));
  };

  return { saveFounderOpsReviewWindow };
}
