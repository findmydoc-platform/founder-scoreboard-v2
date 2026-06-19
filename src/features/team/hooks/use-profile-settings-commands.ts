"use client";

import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import * as planningApi from "@/features/planning/model/planning-api-client";
import type { NotificationPreference, Profile } from "@/lib/types";

export function useProfileSettingsCommands({
  apiClient,
  data,
  setData,
  setSaveError,
  source,
}: PlanningCommandContext) {
  const saveProfileSettings = async (profile: Profile, patch: Partial<Profile>, notificationEvents: Record<string, boolean>) => {
    setSaveError("");
    const previousData = data;
    const changedNotificationEvents = Object.entries(notificationEvents).filter(([eventType, enabled]) => {
      const currentPreference = data.notificationPreferences.find((item) => item.profileId === profile.id && item.channel === "google_chat" && item.eventType === eventType);
      return (currentPreference?.enabled !== false) !== enabled;
    });

    setData((current) => {
      const nextPreferences = changedNotificationEvents.reduce((preferences, [eventType, enabled]) => {
        const existing = preferences.find((item) => item.profileId === profile.id && item.channel === "google_chat" && item.eventType === eventType);
        if (existing) {
          return preferences.map((item) =>
            item.profileId === profile.id && item.channel === "google_chat" && item.eventType === eventType ? { ...item, enabled } : item
          );
        }
        return [
          {
            id: Date.now() + preferences.length,
            profileId: profile.id,
            channel: "google_chat",
            eventType,
            enabled,
          } satisfies NotificationPreference,
          ...preferences,
        ];
      }, current.notificationPreferences);

      return {
        ...current,
        profiles: current.profiles.map((item) => {
          if (item.id === profile.id) return { ...item, ...patch };
          if (patch.platformRole === "ceo" && item.platformRole === "ceo") {
            return { ...item, platformRole: "founder", orgRole: item.orgRole === "CEO" ? "Founder" : item.orgRole };
          }
          return item;
        }),
        notificationPreferences: nextPreferences,
      };
    });

    if (source !== "supabase") return;

    try {
      const { response: profileResponse, body: profileBody } = await planningApi.updateProfileRequest(apiClient, profile.id, {
        githubLogin: patch.githubLogin,
        platformRole: patch.platformRole,
        orgRole: patch.orgRole,
        deputyFor: patch.deputyFor,
        deputyActiveFrom: patch.deputyActiveFrom,
        deputyActiveUntil: patch.deputyActiveUntil,
        focus: patch.focus,
        weeklyCapacity: patch.weeklyCapacity,
        color: patch.color,
        googleChatUserId: patch.googleChatUserId,
        googleChatDmSpace: patch.googleChatDmSpace,
        notificationsEnabled: patch.notificationsEnabled,
        googleCalendarEmail: patch.googleCalendarEmail,
        googleCalendarSyncEnabled: patch.googleCalendarSyncEnabled,
      });
      if (!profileResponse.ok) throw new Error(profileBody?.error || "Profil konnte nicht gespeichert werden.");

      const savedPreferences: NotificationPreference[] = [];
      for (const [eventType, enabled] of changedNotificationEvents) {
        const { response: preferenceResponse, body: preferenceBody } = await planningApi.updateNotificationPreferenceRequest(apiClient, { profileId: profile.id, eventType, enabled });
        if (!preferenceResponse.ok || !preferenceBody?.preference) throw new Error(preferenceBody?.error || "Benachrichtigungseinstellung konnte nicht gespeichert werden.");
        savedPreferences.push(preferenceBody.preference);
      }

      setData((current) => ({
        ...current,
        profiles: profileBody?.profile
          ? current.profiles.map((item) => (item.id === profile.id ? { ...item, ...profileBody.profile } : item))
          : current.profiles,
        notificationPreferences: savedPreferences.length
          ? current.notificationPreferences.map((item) => {
            const saved = savedPreferences.find((preference) => preference.profileId === item.profileId && preference.channel === item.channel && preference.eventType === item.eventType);
            return saved || item;
          })
          : current.notificationPreferences,
      }));
    } catch (error) {
      setData(previousData);
      setSaveError(error instanceof Error ? error.message : "Profil konnte nicht gespeichert werden.");
      throw error;
    }
  };

  return { saveProfileSettings };
}
