"use client";

import { useState } from "react";
import { appNavItems, type AppWorkspace } from "@/features/planning/organisms/app-sidebar";
import { quickFilters, viewTabs } from "@/features/planning/model/planning-app-model";
import { BoardSettingsSection } from "@/features/profile/molecules/profile-board-section";
import { ProfileIdentitySection } from "@/features/profile/molecules/profile-identity-section";
import { NotificationSettingsSection } from "@/features/profile/molecules/profile-notification-section";
import { ProfileSettingsNavButton, profileSettingsSections } from "@/features/profile/molecules/profile-settings-layout";
import {
  buildInitialDraft,
  defaultFilters,
  expandedPackageIds,
  serializeDraft,
  type ProfileSettingsDraft,
  type ProfileSettingsSectionId,
} from "@/features/profile/model/profile-settings-view-model";
import type { OwnProfileSettingsPatch } from "@/features/profile/hooks/use-own-profile-settings-commands";
import { taskStatuses } from "@/lib/status";
import type { PlanningData, PlanningFilterPreferences, Profile, ViewMode } from "@/lib/types";
import { UiButton, UiEmptyState, UiNotice, UiPanel } from "@/shared/atoms/ui-primitives";

type ProfileSettingsOverviewProps = {
  data: PlanningData;
  currentProfile: Profile | null;
  expandedPackages: Record<string, boolean>;
  filters: PlanningFilterPreferences;
  pending: boolean;
  source: "seed" | "supabase";
  view: ViewMode;
  workspace: AppWorkspace;
  onSaveOwnProfileSettings: (patch: OwnProfileSettingsPatch) => Promise<void>;
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
  onSaveOwnProfileSettings,
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
    </div>
  );
}
