"use client";

import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import { ProfileColorConflictError, recoverProfileColorConflict } from "@/features/profile/model/profile-color-api";
import type { OwnProfileSettingsPatch } from "@/features/profile/model/profile-settings-contract";
export type { OwnProfileSettingsPatch } from "@/features/profile/model/profile-settings-contract";

export function useOwnProfileSettingsCommands({ planningState, currentProfile, setSaveError }: Pick<PlanningCommandContext, "planningState" | "currentProfile" | "setSaveError">) {
  const saveOwnProfileSettings = async (patch: OwnProfileSettingsPatch) => {
    if (!currentProfile) return;
    setSaveError("");
    const result = await planningState.saveOwnProfileSettings(currentProfile.id, patch);
    if (result.ok) return;
    if (result.code === "profile_color_conflict") {
      const error: ProfileColorConflictError = await recoverProfileColorConflict(() => planningState.checkOwnProfileSettings(currentProfile.id));
      setSaveError(error.message);
      throw error;
    }
    setSaveError(result.error);
    throw new Error(result.error);
  };
  return { saveOwnProfileSettings };
}
