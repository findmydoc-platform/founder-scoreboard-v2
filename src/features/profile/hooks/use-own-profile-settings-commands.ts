"use client";

import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as planningApi from "@/features/planning/model/planning-api-client";
import type { NotificationPreference, Profile, ProfileUiPreference } from "@/lib/types";

export type OwnProfileSettingsPatch = {
  profilePatch?: Partial<Pick<Profile, "focus" | "color" | "notificationsEnabled">>;
  notificationEvents?: Record<string, boolean>;
  uiPreferences?: Pick<ProfileUiPreference, "defaultWorkspace" | "defaultTaskView" | "planningFilters" | "expandedPackageIds">;
};

function upsertNotificationPreferences(
  preferences: NotificationPreference[],
  profileId: string,
  notificationEvents: Record<string, boolean>,
) {
  return Object.entries(notificationEvents).reduce((next, [eventType, enabled]) => {
    const existing = next.find((item) => item.profileId === profileId && item.channel === "google_chat" && item.eventType === eventType);
    if (existing) {
      return next.map((item) =>
        item.profileId === profileId && item.channel === "google_chat" && item.eventType === eventType ? { ...item, enabled } : item,
      );
    }
    return [
      {
        id: Date.now() + next.length,
        profileId,
        channel: "google_chat",
        eventType,
        enabled,
      } satisfies NotificationPreference,
      ...next,
    ];
  }, preferences);
}

function upsertUiPreference(
  preferences: ProfileUiPreference[],
  profileId: string,
  patch: OwnProfileSettingsPatch["uiPreferences"],
) {
  if (!patch) return preferences;
  const now = new Date().toISOString();
  const existing = preferences.find((item) => item.profileId === profileId);
  const nextPreference: ProfileUiPreference = {
    profileId,
    defaultWorkspace: patch.defaultWorkspace,
    defaultTaskView: patch.defaultTaskView,
    planningFilters: patch.planningFilters,
    expandedPackageIds: patch.expandedPackageIds,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  return existing
    ? preferences.map((item) => (item.profileId === profileId ? nextPreference : item))
    : [nextPreference, ...preferences];
}

function mergeSavedPreferences(
  preferences: NotificationPreference[],
  savedPreferences: NotificationPreference[],
) {
  if (!savedPreferences.length) return preferences;
  return savedPreferences.reduce((next, saved) => {
    const existing = next.find((item) => item.profileId === saved.profileId && item.channel === saved.channel && item.eventType === saved.eventType);
    return existing
      ? next.map((item) => (item.profileId === saved.profileId && item.channel === saved.channel && item.eventType === saved.eventType ? saved : item))
      : [saved, ...next];
  }, preferences);
}

export function useOwnProfileSettingsCommands({
  apiClient,
  currentProfile,
  data,
  setData,
  setSaveError,
  source,
}: PlanningCommandContext) {
  const saveOwnProfileSettings = async (patch: OwnProfileSettingsPatch) => {
    if (!currentProfile) return;
    setSaveError("");
    const profileId = currentProfile.id;
    const previousData = data;

    setData((current) => ({
      ...current,
      profiles: patch.profilePatch
        ? current.profiles.map((profile) => (profile.id === profileId ? { ...profile, ...patch.profilePatch } : profile))
        : current.profiles,
      notificationPreferences: patch.notificationEvents
        ? upsertNotificationPreferences(current.notificationPreferences, profileId, patch.notificationEvents)
        : current.notificationPreferences,
      profileUiPreferences: upsertUiPreference(current.profileUiPreferences, profileId, patch.uiPreferences),
    }));

    if (source !== "supabase") return;

    try {
      const { response, body } = await planningApi.updateOwnProfileSettingsRequest(apiClient, {
        ...(patch.profilePatch || {}),
        notificationEvents: patch.notificationEvents,
        uiPreferences: patch.uiPreferences
          ? {
            defaultWorkspace: patch.uiPreferences.defaultWorkspace,
            defaultTaskView: patch.uiPreferences.defaultTaskView,
            planningFilters: patch.uiPreferences.planningFilters,
            expandedPackageIds: patch.uiPreferences.expandedPackageIds,
          }
          : undefined,
      });
      if (!response.ok) throw new Error(body?.error || "Profil konnte nicht gespeichert werden.");

      setData((current) => ({
        ...current,
        profiles: body?.profile
          ? current.profiles.map((profile) => (profile.id === profileId ? body.profile! : profile))
          : current.profiles,
        notificationPreferences: mergeSavedPreferences(current.notificationPreferences, body?.notificationPreferences || []),
        profileUiPreferences: body?.uiPreference
          ? upsertUiPreference(current.profileUiPreferences, profileId, body.uiPreference)
          : current.profileUiPreferences,
      }));
    } catch (error) {
      setData(previousData);
      setSaveError(error instanceof Error ? error.message : "Profil konnte nicht gespeichert werden.");
      throw error;
    }
  };

  return { saveOwnProfileSettings };
}
