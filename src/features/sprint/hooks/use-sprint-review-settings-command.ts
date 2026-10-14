"use client";

import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import { updateSprintReviewWindowRequest } from "@/features/planning/model/planning-api-client";
import { applyReviewWindowHours } from "@/features/sprint/model/sprint-review-settings-state";

export function useSprintReviewSettingsCommand({
  apiClient,
  applyPlanningShellStateUpdate,
  currentProfile,
  data,
  setSaveError,
}: PlanningCommandContext) {
  const saveSprintReviewWindow = async (reviewObjectionWindowHours: number) => {
    if (currentProfile?.platformRole !== "ceo") throw new Error("Nur der CEO kann diese Prozesseinstellung ändern.");

    setSaveError("");
    const expectedHours = data.project.reviewObjectionWindowHours;
    const { response, body } = await updateSprintReviewWindowRequest(apiClient, expectedHours, reviewObjectionWindowHours);
    if (!response.ok || !body?.project) throw new Error(body?.error || "Prozesseinstellung konnte nicht gespeichert werden.");
    applyPlanningShellStateUpdate((current) => applyReviewWindowHours(
      current,
      body.project!.reviewObjectionWindowHours,
      body.sprints || [],
    ));
  };

  return { saveSprintReviewWindow };
}
