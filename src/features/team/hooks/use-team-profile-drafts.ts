"use client";

import { useState } from "react";
import { profileHasDraftChanges, type TeamProfileDraft } from "@/features/team/model/team-profile-view-model";
import type { TeamProfileEditor } from "@/features/planning/model/planning-team-state";
import type { Profile } from "@/lib/types";

export function useTeamProfileDrafts({
  onSaveProfileSettings,
}: {
  onSaveProfileSettings: (profile: Profile, patch: Partial<Profile>, editor?: TeamProfileEditor, resave?: boolean) => Promise<void>;
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

  const saveProfileDraft = async (profile: Profile, editor?: TeamProfileEditor, resave = false) => {
    const draft = drafts[profile.id];
    if (!draft || !isProfileDirty(profile) && !(resave && editor?.view().phase === "conflict")) return false;
    setSavingProfileId(profile.id);
    setProfileSaveMessage("");
    try {
      await onSaveProfileSettings(profile, draft, editor, resave);
      resetProfileDraft(profile.id);
      setProfileSaveMessage(`${profile.name} gespeichert.`);
      return true;
    } catch (error) {
      setProfileSaveMessage(error instanceof Error ? error.message : "Profil konnte nicht gespeichert werden.");
      return false;
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
