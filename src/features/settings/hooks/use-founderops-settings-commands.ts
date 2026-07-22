"use client";

import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import { persistLocalPlanningData } from "@/features/planning/hooks/use-local-planning-state";
import { updateFounderOpsGitHubProjectRequest, updateFounderOpsReviewWindowRequest } from "@/features/planning/model/planning-api-client";
import { applyGitHubProjectSettings, applyReviewWindowHours } from "@/features/settings/model/founderops-settings-state";
import { canManageFounderOpsGitHubProject } from "@/lib/platform";

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

  const saveFounderOpsGitHubProject = async (githubProjectOwner: string, githubProjectNumber: number) => {
    if (!canManageFounderOpsGitHubProject(currentProfile)) {
      throw new Error("Nur der CEO oder ein aktuell aktiver Deputy kann das GitHub Project ändern.");
    }

    setSaveError("");
    const expectedOwner = data.project.githubProjectOwner;
    const expectedNumber = data.project.githubProjectNumber;

    if (source !== "supabase") {
      const localData = applyGitHubProjectSettings(data, githubProjectOwner, githubProjectNumber);
      applyPlanningDataUpdate(() => localData);
      persistLocalPlanningData(localData);
      return;
    }

    const { response, body } = await updateFounderOpsGitHubProjectRequest(
      apiClient,
      expectedOwner,
      expectedNumber,
      githubProjectOwner,
      githubProjectNumber,
    );
    if (!response.ok || !body?.project) throw new Error(body?.error || "GitHub Project konnte nicht geprüft und gespeichert werden.");
    applyPlanningDataUpdate((current) => applyGitHubProjectSettings(
      current,
      body.project!.githubProjectOwner,
      body.project!.githubProjectNumber,
    ));
  };

  return { saveFounderOpsGitHubProject, saveFounderOpsReviewWindow };
}
