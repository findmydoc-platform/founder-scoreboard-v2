"use client";

import { useMemo, useState } from "react";
import { MeetingAvailabilityDialog } from "@/features/meetings/organisms/meeting-availability-dialog";
import { useMeetingAvailabilityEditor } from "@/features/meetings/hooks/use-meeting-availability-editor";
import { appNavItems, type AppWorkspace } from "@/features/planning/organisms/app-sidebar";
import { quickFilters, viewTabs } from "@/features/planning/model/planning-app-model";
import { AvailabilitySettingsSection } from "@/features/profile/molecules/profile-availability-section";
import { BoardSettingsSection } from "@/features/profile/molecules/profile-board-section";
import { CalendarSettingsSection } from "@/features/profile/molecules/profile-calendar-section";
import { ProfileIdentitySection } from "@/features/profile/molecules/profile-identity-section";
import { NotificationSettingsSection } from "@/features/profile/molecules/profile-notification-section";
import { ProfileSettingsNavButton, profileSettingsSections } from "@/features/profile/molecules/profile-settings-layout";
import {
  buildInitialDraft,
  defaultFilters,
  expandedPackageIds,
  serializeDraft,
  sortAvailabilityEntries,
  type ProfileSettingsDraft,
  type ProfileSettingsSectionId,
} from "@/features/profile/model/profile-settings-view-model";
import type { OwnProfileSettingsPatch } from "@/features/profile/hooks/use-own-profile-settings-commands";
import { addDaysIso, currentIsoDate } from "@/lib/planning-schedule";
import { taskStatuses } from "@/lib/status";
import type { AvailabilityEntry, PlanningData, PlanningFilterPreferences, Profile, ViewMode } from "@/lib/types";
import { UiButton, UiEmptyState, UiNotice, UiPanel } from "@/shared/atoms/ui-primitives";
import { timeToMinutes } from "@/features/meetings/model/meeting-finder";

type ProfileSettingsOverviewProps = {
  data: PlanningData;
  currentProfile: Profile | null;
  expandedPackages: Record<string, boolean>;
  filters: PlanningFilterPreferences;
  pending: boolean;
  source: "seed" | "supabase";
  view: ViewMode;
  workspace: AppWorkspace;
  onCreateAvailability: (entry: Omit<AvailabilityEntry, "id">) => void;
  onDeleteAvailability: (entry: AvailabilityEntry) => void;
  onSaveOwnProfileSettings: (patch: OwnProfileSettingsPatch) => Promise<void>;
  onUpdateAvailability: (entry: AvailabilityEntry, patch: Partial<Omit<AvailabilityEntry, "id" | "source" | "externalId" | "externalCalendarId" | "syncedAt">>) => void;
};

export function ProfileSettingsOverview(props: ProfileSettingsOverviewProps) {
  const { currentProfile, data } = props;
  if (!currentProfile) {
    return (
      <UiPanel padding="xl">
        <UiEmptyState minHeight="md">Kein eigenes Profil verfügbar.</UiEmptyState>
      </UiPanel>
    );
  }

  const profileUiPreference = data.profileUiPreferences.find((item) => item.profileId === currentProfile.id);

  return (
    <ProfileSettingsForm
      key={`${currentProfile.id}:${profileUiPreference?.updatedAt || "empty"}`}
      {...props}
      currentProfile={currentProfile}
      profileUiPreference={profileUiPreference || null}
    />
  );
}

function ProfileSettingsForm({
  data,
  currentProfile,
  expandedPackages,
  filters,
  pending,
  source,
  view,
  workspace,
  onCreateAvailability,
  onDeleteAvailability,
  onSaveOwnProfileSettings,
  onUpdateAvailability,
  profileUiPreference,
}: Omit<ProfileSettingsOverviewProps, "currentProfile"> & { currentProfile: Profile; profileUiPreference: NonNullable<PlanningData["profileUiPreferences"][number]> | null }) {
  const initialDraft = buildInitialDraft({ currentProfile, data, expandedPackages, filters, profileUiPreference, view, workspace });
  const [draft, setDraft] = useState<ProfileSettingsDraft>(() => initialDraft);
  const [savedSnapshot, setSavedSnapshot] = useState(() => serializeDraft(initialDraft));
  const [activeSection, setActiveSection] = useState<ProfileSettingsSectionId>("profile");
  const [advancedBoardOpen, setAdvancedBoardOpen] = useState(false);
  const [message, setMessage] = useState("");
  const draftSnapshot = serializeDraft(draft);
  const isDirty = draftSnapshot !== savedSnapshot;

  const profileOptions = useMemo(
    () => [{ value: currentProfile.id, label: currentProfile.name }],
    [currentProfile],
  );
  const availability = useMemo(
    () => data.availability.filter((entry) => entry.profileId === currentProfile.id),
    [currentProfile.id, data.availability],
  );
  const workingHours = sortAvailabilityEntries(availability.filter((entry) => entry.type === "working_hours"));
  const blockers = sortAvailabilityEntries(availability.filter((entry) => entry.type !== "working_hours"));
  const today = currentIsoDate();
  const calendarDates = Array.from({ length: 7 }, (_, index) => addDaysIso(today, index));
  const availabilityEditor = useMeetingAvailabilityEditor({
    today,
    editableProfiles: [currentProfile],
    defaultEditableProfileId: currentProfile.id,
    canManageAvailability: false,
    currentProfileId: currentProfile.id,
    onCreateAvailability,
    onUpdateAvailability,
    onDeleteAvailability,
  });

  const workspaceOptions = [
    ...appNavItems
      .filter((item) => !item.ceoOnly || currentProfile.platformRole === "ceo")
      .map((item) => ({ value: item.id, label: item.label })),
    { value: "profile", label: "Mein Profil" },
  ];
  const viewOptions = viewTabs.map((item) => ({ value: item.id, label: item.label }));
  const ownerOptions = [{ value: "Alle", label: "Alle" }, ...data.profiles.map((profile) => ({ value: profile.id, label: profile.name }))];
  const statusOptions = [{ value: "Alle", label: "Alle" }, ...taskStatuses.map((status) => ({ value: status, label: status }))];
  const priorityOptions = ["Alle", "P0", "P1", "P2", "P3", "P4"].map((priority) => ({ value: priority, label: priority }));
  const packageOptions = [{ value: "Alle", label: "Alle" }, ...data.packages.map((pack) => ({ value: pack.id, label: pack.title }))];
  const quickFilterOptions = [{ value: "", label: "Kein Schnellfilter" }, ...quickFilters.map((item) => ({ value: item.id, label: item.label }))];

  const updateDraft = <Key extends keyof ProfileSettingsDraft>(key: Key, value: ProfileSettingsDraft[Key]) => {
    setMessage("");
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const updatePlanningFilters = (patch: Partial<PlanningFilterPreferences>) => {
    setMessage("");
    setDraft((current) => ({ ...current, planningFilters: { ...current.planningFilters, ...patch } }));
  };

  const updateNotificationEvent = (eventType: string, enabled: boolean) => {
    setMessage("");
    setDraft((current) => ({
      ...current,
      notificationEvents: {
        ...current.notificationEvents,
        [eventType]: enabled,
      },
    }));
  };

  const toggleExpandedPackage = (packageId: string) => {
    setMessage("");
    setDraft((current) => ({
      ...current,
      expandedPackageIds: current.expandedPackageIds.includes(packageId)
        ? current.expandedPackageIds.filter((item) => item !== packageId)
        : [...current.expandedPackageIds, packageId],
    }));
  };

  const saveCurrentBoardDefaults = () => {
    setMessage("");
    setDraft((current) => ({
      ...current,
      defaultWorkspace: workspace === "profile" ? "planning" : workspace,
      defaultTaskView: view,
      planningFilters: defaultFilters(filters),
      expandedPackageIds: expandedPackageIds(expandedPackages),
    }));
  };

  const save = async () => {
    setMessage("");
    const nextSnapshot = serializeDraft(draft);
    await onSaveOwnProfileSettings({
      profilePatch: {
        focus: draft.focus,
        color: draft.color,
        notificationsEnabled: draft.notificationsEnabled,
        googleCalendarEmail: draft.googleCalendarEmail,
        googleCalendarSyncEnabled: draft.googleCalendarSyncEnabled,
      },
      notificationEvents: draft.notificationEvents,
      uiPreferences: {
        defaultWorkspace: draft.defaultWorkspace,
        defaultTaskView: draft.defaultTaskView,
        planningFilters: draft.planningFilters,
        expandedPackageIds: draft.expandedPackageIds,
      },
    });
    setSavedSnapshot(nextSnapshot);
    setMessage(source === "supabase" ? "Gespeichert." : "Lokal gespeichert.");
  };

  const saveAvailabilityDialogDisabled =
    pending ||
    !availabilityEditor.normalizedBlockerProfileId ||
    !availabilityEditor.blockerTitle.trim() ||
    (!availabilityEditor.blockerAllDay && timeToMinutes(availabilityEditor.blockerStartTime) >= timeToMinutes(availabilityEditor.blockerEndTime));

  return (
    <div className="min-w-0 pb-24">
      <div className="mb-4 flex gap-2 overflow-x-auto lg:hidden" aria-label="Profilbereiche">
        {profileSettingsSections.map((section) => (
          <ProfileSettingsNavButton
            key={section.id}
            active={activeSection === section.id}
            section={section}
            compact
            onClick={() => setActiveSection(section.id)}
          />
        ))}
      </div>

      <div className="grid min-w-0 gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="hidden min-w-0 lg:block">
          <nav className="sticky top-4 rounded-lg border border-slate-200 bg-white p-2 shadow-sm" aria-label="Profileinstellungen">
            {profileSettingsSections.map((section) => (
              <ProfileSettingsNavButton
                key={section.id}
                active={activeSection === section.id}
                section={section}
                onClick={() => setActiveSection(section.id)}
              />
            ))}
          </nav>
        </aside>

        <div className="min-w-0 rounded-lg border border-slate-200 bg-white shadow-sm" data-profile-settings-section={activeSection}>
          {activeSection === "profile" && (
            <ProfileIdentitySection
              currentProfile={currentProfile}
              draft={draft}
              onColorChange={(color) => updateDraft("color", color)}
              onFocusChange={(focus) => updateDraft("focus", focus)}
            />
          )}
          {activeSection === "notifications" && (
            <NotificationSettingsSection
              draft={draft}
              pending={pending}
              onMasterChange={(enabled) => updateDraft("notificationsEnabled", enabled)}
              onEventChange={updateNotificationEvent}
            />
          )}
          {activeSection === "calendar" && (
            <CalendarSettingsSection
              draft={draft}
              pending={pending}
              onEmailChange={(email) => updateDraft("googleCalendarEmail", email)}
              onSyncChange={(enabled) => updateDraft("googleCalendarSyncEnabled", enabled)}
            />
          )}
          {activeSection === "availability" && (
            <AvailabilitySettingsSection
              availability={availability}
              blockers={blockers}
              calendarDates={calendarDates}
              pending={pending}
              today={today}
              workingHours={workingHours}
              editor={availabilityEditor}
              onDeleteAvailability={onDeleteAvailability}
            />
          )}
          {activeSection === "board" && (
            <BoardSettingsSection
              advancedBoardOpen={advancedBoardOpen}
              data={data}
              draft={draft}
              packageOptions={packageOptions}
              priorityOptions={priorityOptions}
              quickFilterOptions={quickFilterOptions}
              statusOptions={statusOptions}
              ownerOptions={ownerOptions}
              viewOptions={viewOptions}
              workspaceOptions={workspaceOptions}
              onAdvancedBoardOpenChange={setAdvancedBoardOpen}
              onCurrentBoardSave={saveCurrentBoardDefaults}
              onDefaultTaskViewChange={(defaultTaskView) => updateDraft("defaultTaskView", defaultTaskView)}
              onDefaultWorkspaceChange={(defaultWorkspace) => updateDraft("defaultWorkspace", defaultWorkspace)}
              onPackageToggle={toggleExpandedPackage}
              onPlanningFiltersChange={updatePlanningFilters}
            />
          )}
        </div>
      </div>

      {(isDirty || message) && (
        <div className="sticky bottom-4 z-10 mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur" data-profile-save-bar>
          <div className="text-sm font-semibold text-slate-700">
            {isDirty ? "Ungespeicherte Änderungen" : message}
          </div>
          <div className="flex items-center gap-2">
            {isDirty && message && <UiNotice tone="success" size="compact">{message}</UiNotice>}
            {isDirty && (
              <UiButton onClick={save} disabled={pending} variant="primary">
                Speichern
              </UiButton>
            )}
          </div>
        </div>
      )}

      {availabilityEditor.availabilityDialogMode && (
        <MeetingAvailabilityDialog
          mode={availabilityEditor.availabilityDialogMode}
          hasEditingAvailability={Boolean(availabilityEditor.editingAvailability)}
          normalizedBlockerProfileId={availabilityEditor.normalizedBlockerProfileId}
          profileOptions={profileOptions}
          canManageAvailability={false}
          pending={pending}
          blockerTitle={availabilityEditor.blockerTitle}
          blockerKind={availabilityEditor.blockerKind}
          blockerStartDate={availabilityEditor.blockerStartDate}
          blockerEndDate={availabilityEditor.blockerEndDate}
          blockerAllDay={availabilityEditor.blockerAllDay}
          blockerStartTime={availabilityEditor.blockerStartTime}
          blockerEndTime={availabilityEditor.blockerEndTime}
          blockerNote={availabilityEditor.blockerNote}
          saveDisabled={saveAvailabilityDialogDisabled}
          showProfileSelect={false}
          onClose={availabilityEditor.closeAvailabilityDialog}
          onDelete={availabilityEditor.deleteAvailabilityDialogEntry}
          onSave={availabilityEditor.saveAvailabilityDialog}
          onBlockerProfileChange={availabilityEditor.setBlockerProfileId}
          onBlockerTitleChange={availabilityEditor.setBlockerTitle}
          onBlockerKindChange={availabilityEditor.setBlockerKind}
          onBlockerStartDateChange={availabilityEditor.setBlockerStartDate}
          onBlockerEndDateChange={availabilityEditor.setBlockerEndDate}
          onBlockerAllDayChange={availabilityEditor.setBlockerAllDay}
          onBlockerStartTimeChange={availabilityEditor.setBlockerStartTime}
          onBlockerEndTimeChange={availabilityEditor.setBlockerEndTime}
          onBlockerNoteChange={availabilityEditor.setBlockerNote}
        />
      )}
    </div>
  );
}
