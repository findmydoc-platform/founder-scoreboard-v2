"use client";

import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import type { TeamProfileEditor, TeamProfilePatch } from "@/features/planning/model/planning-team-state";
import type { Profile } from "@/lib/types";

export function useProfileSettingsCommands({ planningState, setSaveError }: Pick<PlanningCommandContext, "planningState" | "setSaveError">) {
  const saveProfileSettings = async (profile: Profile, patch: Partial<Profile>, editor?: TeamProfileEditor, resave = false) => {
    setSaveError("");
    const input: TeamProfilePatch = {
      ...(patch.platformRole !== undefined ? { platformRole: patch.platformRole } : {}),
      ...(patch.orgRole !== undefined ? { orgRole: patch.orgRole } : {}),
      ...(patch.weeklyCapacity !== undefined ? { weeklyCapacity: patch.weeklyCapacity } : {}),
      ...(patch.deputyFor !== undefined ? { deputyFor: patch.deputyFor } : {}),
      ...(patch.deputyActiveFrom !== undefined ? { deputyActiveFrom: patch.deputyActiveFrom } : {}),
      ...(patch.deputyActiveUntil !== undefined ? { deputyActiveUntil: patch.deputyActiveUntil } : {}),
    };
    const result = await (editor ? resave ? editor.resave(input) : editor.save(input) : planningState.saveTeamProfile(profile.id, input));
    if (result.ok) return;
    setSaveError(result.error);
    throw new Error(result.error);
  };
  return { saveProfileSettings };
}
