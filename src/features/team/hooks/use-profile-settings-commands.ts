"use client";

import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as planningApi from "@/features/planning/model/planning-api-client";
import type { Profile } from "@/lib/types";

export function useProfileSettingsCommands({
  apiClient,
  data,
  setData,
  setSaveError,
  source,
}: PlanningCommandContext) {
  const saveProfileSettings = async (profile: Profile, patch: Partial<Profile>) => {
    setSaveError("");
    const previousData = data;
    setData((current) => {
      return {
        ...current,
        profiles: current.profiles.map((item) => {
          if (item.id === profile.id) return { ...item, ...patch };
          if (patch.platformRole === "ceo" && item.platformRole === "ceo") {
            return { ...item, platformRole: "founder", orgRole: item.orgRole === "CEO" ? "Founder" : item.orgRole };
          }
          return item;
        }),
      };
    });

    if (source !== "supabase") return;

    try {
      const { response: profileResponse, body: profileBody } = await planningApi.updateProfileRequest(apiClient, profile.id, {
        platformRole: patch.platformRole,
        orgRole: patch.orgRole,
        deputyFor: patch.deputyFor,
        deputyActiveFrom: patch.deputyActiveFrom,
        deputyActiveUntil: patch.deputyActiveUntil,
        weeklyCapacity: patch.weeklyCapacity,
      });
      if (!profileResponse.ok) throw new Error(profileBody?.error || "Profil konnte nicht gespeichert werden.");

      setData((current) => ({
        ...current,
        profiles: profileBody?.profile
          ? current.profiles.map((item) => (item.id === profile.id ? { ...item, ...profileBody.profile } : item))
          : current.profiles,
      }));
    } catch (error) {
      setData(previousData);
      setSaveError(error instanceof Error ? error.message : "Profil konnte nicht gespeichert werden.");
      throw error;
    }
  };

  return { saveProfileSettings };
}
