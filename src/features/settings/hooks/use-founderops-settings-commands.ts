"use client";

import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import { updateFounderOpsGitHubProjectRequest, updateFounderOpsReviewWindowRequest } from "@/features/planning/model/planning-api-client";
import { applyGitHubProjectSettings, applyReviewWindowHours } from "@/features/settings/model/founderops-settings-state";
import { isLocalLoginSimulationEnabled } from "@/lib/local-development-auth";
import { canConfigureFounderOpsGitHubProject } from "@/lib/platform";

export function useFounderOpsSettingsCommands({
  apiClient,
  applyPlanningDataUpdate,
  currentProfile,
  data,
  setSaveError,
}: PlanningCommandContext) {
  const saveFounderOpsReviewWindow = async (reviewObjectionWindowHours: number) => {
    if (currentProfile?.platformRole !== "ceo") throw new Error("Nur der CEO kann diese Prozesseinstellung ändern.");

    setSaveError("");
    const expectedHours = data.project.reviewObjectionWindowHours;

    const { response, body } = await updateFounderOpsReviewWindowRequest(apiClient, expectedHours, reviewObjectionWindowHours);
    if (!response.ok || !body?.project) throw new Error(body?.error || "Prozesseinstellung konnte nicht gespeichert werden.");
    applyPlanningDataUpdate((current) => applyReviewWindowHours(
      current,
      body.project!.reviewObjectionWindowHours,
      body.sprints || [],
    ));
  };

  const saveFounderOpsGitHubProject = async (githubProjectOwner: string, githubProjectNumber: number) => {
    if (!canConfigureFounderOpsGitHubProject(currentProfile)) {
      throw new Error("Nur der CEO kann das GitHub Project ändern.");
    }
    if (isLocalLoginSimulationEnabled()) {
      throw new Error("Das globale GitHub Project ist im lokalen Simulationsmodus deaktiviert.");
    }

    setSaveError("");
    const expectedOwner = data.project.githubProjectOwner;
    const expectedNumber = data.project.githubProjectNumber;

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
