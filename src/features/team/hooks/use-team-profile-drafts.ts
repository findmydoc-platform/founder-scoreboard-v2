"use client";

import { useState } from "react";
import { profileHasDraftChanges, type TeamProfileDraft } from "@/features/team/model/team-profile-view-model";
import type { Profile } from "@/lib/types";

export function useTeamProfileDrafts({
  onSaveProfileSettings,
}: {
  onSaveProfileSettings: (profile: Profile, patch: Partial<Profile>, eventPatch: Record<string, boolean>) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, TeamProfileDraft>>({});
  const [savingProfileId, setSavingProfileId] = useState("");
  const [profileSaveMessage, setProfileSaveMessage] = useState("");

  const draftFor = (profile: Profile) => ({
    ...profile,
    ...(drafts[profile.id] || {}),
  });

  const setProfileDraft = (profileId: string, patch: Partial<Profile>) => {
    setProfileSaveMessage("");
    setDrafts((current) => ({
      ...current,
      [profileId]: { ...(current[profileId] || {}), ...patch },
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

  const isProfileDirty = (profile: Profile) => profileHasDraftChanges(profile, drafts[profile.id]);

  const saveProfileDraft = async (profile: Profile) => {
    const draft = drafts[profile.id];
    if (!draft || !isProfileDirty(profile)) return;
    setSavingProfileId(profile.id);
    setProfileSaveMessage("");
    try {
      await onSaveProfileSettings(profile, draft, {});
      resetProfileDraft(profile.id);
      setProfileSaveMessage(`${profile.name} gespeichert.`);
    } catch (error) {
      setProfileSaveMessage(error instanceof Error ? error.message : "Profil konnte nicht gespeichert werden.");
    } finally {
      setSavingProfileId("");
    }
  };

  return {
    draftFor,
    isProfileDirty,
    profileSaveMessage,
    resetProfileDraft,
    saveProfileDraft,
    savingProfileId,
    setProfileDraft,
  };
}
