"use client";

import { useState } from "react";
import { eventEnabled, profileHasDraftChanges, type ProfileCardDraft } from "@/features/team/model/team-profile-view-model";
import type { PlanningData, Profile } from "@/lib/types";

export function useTeamProfileDrafts({
  data,
  onSaveProfileSettings,
}: {
  data: PlanningData;
  onSaveProfileSettings: (profile: Profile, patch: Partial<Profile>, notificationEvents: Record<string, boolean>) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, ProfileCardDraft>>({});
  const [savingProfileId, setSavingProfileId] = useState("");
  const [profileSaveMessage, setProfileSaveMessage] = useState("");

  const draftFor = (profile: Profile) => ({
    ...profile,
    ...(drafts[profile.id]?.profile || {}),
  });

  const draftEventEnabled = (profileId: string, eventType: string) => {
    const draftValue = drafts[profileId]?.notificationEvents[eventType];
    return draftValue ?? eventEnabled(data, profileId, eventType);
  };

  const setProfileDraft = (profileId: string, patch: Partial<Profile>) => {
    setProfileSaveMessage("");
    setDrafts((current) => ({
      ...current,
      [profileId]: {
        profile: { ...(current[profileId]?.profile || {}), ...patch },
        notificationEvents: current[profileId]?.notificationEvents || {},
      },
    }));
  };

  const setNotificationDraft = (profileId: string, eventType: string, enabled: boolean) => {
    setProfileSaveMessage("");
    setDrafts((current) => ({
      ...current,
      [profileId]: {
        profile: current[profileId]?.profile || {},
        notificationEvents: { ...(current[profileId]?.notificationEvents || {}), [eventType]: enabled },
      },
    }));
  };

  const resetProfileDraft = (profileId: string) => {
    setProfileSaveMessage("");
    setDrafts((current) => {
      const next = { ...current };
      delete next[profileId];
      return next;
    });
  };

  const isProfileDirty = (profile: Profile) => profileHasDraftChanges(data, profile, drafts[profile.id]);

  const saveProfileDraft = async (profile: Profile) => {
    const draft = drafts[profile.id];
    if (!draft || !isProfileDirty(profile)) return;
    setSavingProfileId(profile.id);
    setProfileSaveMessage("");
    try {
      await onSaveProfileSettings(profile, draft.profile, draft.notificationEvents);
      resetProfileDraft(profile.id);
      setProfileSaveMessage(`${profile.name} gespeichert.`);
    } catch (error) {
      setProfileSaveMessage(error instanceof Error ? error.message : "Profil konnte nicht gespeichert werden.");
    } finally {
      setSavingProfileId("");
    }
  };

  return {
    draftEventEnabled,
    draftFor,
    isProfileDirty,
    profileSaveMessage,
    resetProfileDraft,
    saveProfileDraft,
    savingProfileId,
    setNotificationDraft,
    setProfileDraft,
  };
}
