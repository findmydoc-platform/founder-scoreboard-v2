"use client";

import { useTeamProfileDialog } from "@/features/team/hooks/use-team-profile-dialog";
import { useTeamProfileDrafts } from "@/features/team/hooks/use-team-profile-drafts";
import { TeamMemberCard } from "@/features/team/molecules/team-member-card";
import { TeamRoleSummary } from "@/features/team/molecules/team-role-summary";
import { deputyLabel, teamMemberStats } from "@/features/team/model/team-profile-view-model";
import { TeamProfileEditDialog } from "@/features/team/organisms/team-profile-edit-dialog";
import type { PlanningData, Profile, Task } from "@/lib/types";

export function TeamOverview({
  data,
  tasks,
  pending,
  canManageTeam,
  onSaveProfileSettings,
}: {
  data: PlanningData;
  tasks: Task[];
  pending: boolean;
  canManageTeam: boolean;
  onSaveProfileSettings: (profile: Profile, patch: Partial<Profile>, eventPatch: Record<string, boolean>) => Promise<void>;
}) {
  const { closeProfileDialog, editingProfile, openProfileDialog } = useTeamProfileDialog(data.profiles);
  const {
    draftFor,
    isProfileDirty,
    profileSaveMessage,
    resetProfileDraft,
    saveProfileDraft,
    savingProfileId,
    setProfileDraft,
  } = useTeamProfileDrafts({ onSaveProfileSettings });
  const today = new Date().toISOString().slice(0, 10);
  const editingDraftProfile = editingProfile ? draftFor(editingProfile) : null;
  const editingDirty = editingProfile ? isProfileDirty(editingProfile) : false;
  const editingSaving = Boolean(editingProfile && savingProfileId === editingProfile.id);

  const saveDialog = async () => {
    if (!editingProfile) return;
    await saveProfileDraft(editingProfile);
    closeProfileDialog();
  };

  return (
    <div className="grid gap-4">
      <TeamRoleSummary profiles={data.profiles} today={today} />

      <div className="grid gap-2">
        {data.profiles.map((profile) => (
          <TeamMemberCard
            key={profile.id}
            canManageTeam={canManageTeam}
            deputyText={deputyLabel(profile, data.profiles)}
            profile={profile}
            stats={teamMemberStats(tasks, profile)}
            onEdit={() => openProfileDialog(profile.id)}
          />
        ))}
      </div>
      {profileSaveMessage && (
        <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800">{profileSaveMessage}</div>
      )}
      {editingDraftProfile && (
        <TeamProfileEditDialog
          canManageTeam={canManageTeam}
          dirty={editingDirty}
          draftProfile={editingDraftProfile}
          pending={pending}
          profiles={data.profiles}
          saving={editingSaving}
          onClose={closeProfileDialog}
          onPatch={(patch) => setProfileDraft(editingDraftProfile.id, patch)}
          onReset={() => resetProfileDraft(editingDraftProfile.id)}
          onSave={saveDialog}
        />
      )}
    </div>
  );
}
