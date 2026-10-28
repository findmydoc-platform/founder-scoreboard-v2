"use client";

import { useState } from "react";
import type { TeamProfileEditor } from "@/features/planning/model/planning-team-state";
import { useRouter, useSearchParams } from "next/navigation";
import { useTeamProfileDialog } from "@/features/team/hooks/use-team-profile-dialog";
import { useTeamProfileDrafts } from "@/features/team/hooks/use-team-profile-drafts";
import { TeamProfileSaveNotice } from "../molecules/team-profile-save-notice";
import { UiButton, UiNotice } from "@/shared/atoms/ui-primitives";
import { TeamMemberCard } from "@/features/team/molecules/team-member-card";
import { TeamRoleSummary } from "@/features/team/molecules/team-role-summary";
import { deputyLabel, teamMemberStats } from "@/features/team/model/team-profile-view-model";
import { TeamProfileEditDialog } from "@/features/team/organisms/team-profile-edit-dialog";
import { isIsoCalendarDate } from "@/features/team-workweek/model/team-workweek-calendar";
import { PrivateTeamWorkweekCard } from "@/features/team-workweek/molecules/private-team-workweek-card";
import { PublishedTeamWorkweeksCard } from "@/features/team-workweek/molecules/published-team-workweeks-card";
import type { PlanningState } from "@/features/planning/model/planning-state";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { Profile, Task } from "@/lib/types";

function TeamOverviewContent({
  planningState,
  tasks,
  pending,
  canManageTeam,
  apiClient,
  actualProfile,
  onSaveProfileSettings,
}: {
  planningState: PlanningState;
  tasks: Task[];
  pending: boolean;
  canManageTeam: boolean;
  apiClient: BrowserApiClient;
  actualProfile: Profile | null;
  onSaveProfileSettings: (profile: Profile, patch: Partial<Profile>, editor?: TeamProfileEditor, resave?: boolean) => Promise<void>;
}) {
  const team = planningState.team();
  const profiles = [...team.profiles];
  const router = useRouter();
  const searchParams = useSearchParams();
  const weekParameter = searchParams.get("week");
  const week = weekParameter && isIsoCalendarDate(weekParameter) ? weekParameter : undefined;
  const closeWorkweekRequest = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("workweek");
    router.replace(`/team${params.size ? `?${params}` : ""}`, { scroll: false });
  };
  const { closeProfileDialog, editingProfile, openProfileDialog } = useTeamProfileDialog(profiles);
  const {
    draftFor,
    isProfileDirty,
    profileSaveMessage,
    resetProfileDraft,
    saveProfileDraft,
    savingProfileId,
    setProfileDraft,
  } = useTeamProfileDrafts({ onSaveProfileSettings });
  const [editors, setEditors] = useState<Record<string, TeamProfileEditor>>({});
  const editingEditor = editingProfile ? editors[editingProfile.id] : undefined;
  const today = new Date().toISOString().slice(0, 10);
  const editingDraftProfile = editingProfile ? draftFor(editingProfile) : null;
  const editingDirty = editingProfile ? isProfileDirty(editingProfile) : false;
  const editingSaving = Boolean(editingProfile && savingProfileId === editingProfile.id);

  const saveDialog = async (resave = false) => {
    if (!editingProfile) return;
    if (await saveProfileDraft(editingProfile, editingEditor, resave)) closeProfileDialog();
  };

  if (team.readStatus === "forbidden") return <div className="grid gap-3"><UiNotice tone="warning">Teamdaten sind nicht verfügbar.</UiNotice><UiButton className="min-h-11 justify-self-start" onClick={() => { void planningState.refreshWorkspace("team"); }}>Zugriff erneut prüfen</UiButton></div>;
  return (
    <div className="grid gap-4">
      {team.readStatus === "unavailable" && <UiNotice tone="warning">Der aktuelle Teamstand konnte nicht geladen werden. Bereits bekannte Daten bleiben sichtbar.</UiNotice>}
      {team.completeness === "partial" && <UiNotice tone="info">Du siehst nur einen Teil der Teamprofile.</UiNotice>}
      {team.saves.filter(save => save.phase === "unconfirmed" || save.phase === "saved" && save.followup !== "current" && save.followup !== "not-needed").map(save => <TeamProfileSaveNotice profiles={profiles} key={save.profileId} save={save} onCheck={() => planningState.checkTeamProfile(save.profileId)} />)}
      <TeamRoleSummary profiles={profiles} today={today} />

      {actualProfile && (
        <PrivateTeamWorkweekCard planningState={planningState} apiClient={apiClient} profile={actualProfile} editorWeek={week} editorRequested={searchParams.get("workweek") === "edit"} onEditorRequestHandled={closeWorkweekRequest} />
      )}

      {actualProfile && <PublishedTeamWorkweeksCard key={week || "current"} initialDate={week} planningState={planningState} profiles={profiles} />}

      <div className="grid gap-2">
        {profiles.map((profile) => (
          <TeamMemberCard
            key={profile.id}
            canManageTeam={canManageTeam}
            deputyText={deputyLabel(profile, profiles)}
            profile={profile}
            stats={teamMemberStats(tasks, profile)}
            onEdit={() => { if (!editors[profile.id]) setEditors(current => ({ ...current, [profile.id]: planningState.beginTeamProfileEdit(profile) })); openProfileDialog(profile.id); }}
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
          profiles={profiles}
          saving={editingSaving}
          saveState={team.saves.find(save => save.profileId === editingDraftProfile.id)}
          onCheck={() => planningState.checkTeamProfile(editingDraftProfile.id)}
          editor={editingEditor}
          onResave={() => saveDialog(true)}
          onClose={closeProfileDialog}
          onPatch={(patch) => setProfileDraft(editingDraftProfile.id, patch)}
          onReset={() => { resetProfileDraft(editingDraftProfile.id); editingEditor?.close(); const profile = profiles.find(item => item.id === editingDraftProfile.id); if (profile) setEditors(current => ({ ...current, [profile.id]: planningState.beginTeamProfileEdit(profile) })); }}
          onSave={() => saveDialog()}
        />
      )}
    </div>
  );
}

export function TeamOverview(props: Parameters<typeof TeamOverviewContent>[0]) {
  const [binding, setBinding] = useState({ owner: props.planningState, version: 0 });
  if (binding.owner !== props.planningState) setBinding({ owner: props.planningState, version: binding.version + 1 });
  return <TeamOverviewContent key={binding.version} {...props} />;
}
