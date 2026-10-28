"use client";

import { useState } from "react";
import { initiativePlanningItems, quickFilters, viewTabs } from "@/features/planning/model/planning-app-model";
import {
  isPersistedWorkspace,
  workspaceRoutes,
} from "@/features/planning/model/workspace-routes";
import { BoardSettingsSection } from "@/features/profile/molecules/profile-board-section";
import { ProfileIdentitySection } from "@/features/profile/molecules/profile-identity-section";
import { NotificationSettingsSection } from "@/features/profile/molecules/profile-notification-section";
import { ProfilePlanningItemsTokens } from "@/features/profile/organisms/profile-planning-items-tokens";
import { ProfileSettingsNavButton, profileSettingsSections } from "@/features/profile/molecules/profile-settings-layout";
import {
  buildInitialDraft,
  serializeDraft,
  type ProfileSettingsDraft,
  type ProfileSettingsSectionId,
} from "@/features/profile/model/profile-settings-view-model";
import { ProfileColorConflictError } from "@/features/profile/model/profile-color-api";
import {
  buildProfileColorPickerModel,
  buildProfileColorSavePatch,
  restoreProfileColorAfterConflict,
} from "@/features/profile/model/profile-color-policy";
import type { OwnProfileEditor } from "@/features/profile/model/profile-settings-contract";
import type { OwnProfileSettingsPatch } from "@/features/profile/hooks/use-own-profile-settings-commands";
import type { PlanningState } from "@/features/planning/model/planning-state";
import { taskStatuses } from "@/lib/status";
import type { PlanningShellState, PlanningFilterPreferences, Profile } from "@/lib/types";
import { UiButton, UiEmptyState, UiNotice, UiPanel } from "@/shared/atoms/ui-primitives";

type ProfileSettingsOverviewProps = {
  planningState: PlanningState;
  data: PlanningShellState;
  currentProfile: Profile | null;
  pending: boolean;
  source: "supabase";
  onSaveOwnProfileSettings: (patch: OwnProfileSettingsPatch, editor?: OwnProfileEditor, resave?: boolean) => Promise<void>;
};

export function ProfileSettingsOverview(props: ProfileSettingsOverviewProps) {
  const { currentProfile, data } = props;
  const [binding, setBinding] = useState({ owner: props.planningState, version: 0 });
  if (binding.owner !== props.planningState) setBinding({ owner: props.planningState, version: binding.version + 1 });
  const settings = currentProfile ? props.planningState.profileSettings(currentProfile.id) : null;
  if (settings?.readStatus === "forbidden") return <UiPanel padding="xl"><UiNotice tone="warning">Profileinstellungen sind nicht verfügbar.</UiNotice><UiButton className="mt-2 min-h-11" onClick={() => { void props.planningState.checkOwnProfileSettings(currentProfile!.id); }}>Zugriff erneut prüfen</UiButton></UiPanel>;
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
      key={`${currentProfile.id}:${binding.version}`}
      {...props}
      currentProfile={currentProfile}
      profileUiPreference={profileUiPreference || null}
    />
  );
}

function ProfileSettingsForm({
  planningState,
  data,
  currentProfile,
  pending,
  source,
  onSaveOwnProfileSettings,
  profileUiPreference,
}: Omit<ProfileSettingsOverviewProps, "currentProfile"> & { currentProfile: Profile; profileUiPreference: NonNullable<PlanningShellState["profileUiPreferences"][number]> | null }) {
  const settings = planningState.profileSettings(currentProfile.id);
  const confirmationPending = settings.save.phase === "unconfirmed" || settings.save.phase === "saving";
  const [editor] = useState(() => planningState.beginOwnProfileEdit({ profile: currentProfile, uiPreference: profileUiPreference, notificationPreferences: data.notificationPreferences.filter(item => item.profileId === currentProfile.id) }));
  const editing = editor.view();
  const initialDraft = buildInitialDraft({ currentProfile, data, profileUiPreference });
  const [draft, setDraft] = useState<ProfileSettingsDraft>(() => initialDraft);
  const [savedDraft, setSavedDraft] = useState<ProfileSettingsDraft>(() => initialDraft);
  const [activeSection, setActiveSection] = useState<ProfileSettingsSectionId>("profile");
  const [advancedBoardOpen, setAdvancedBoardOpen] = useState(false);
  const [message, setMessage] = useState("");
  const operationalProfile = currentProfile.platformRole === "ceo" || currentProfile.platformRole === "deputy" || currentProfile.platformRole === "founder";
  const visibleSections = profileSettingsSections.filter((section) => {
    if (section.id === "api") return operationalProfile;
    return true;
  });
  const draftSnapshot = serializeDraft(draft);
  const savedSnapshot = serializeDraft(savedDraft);
  const isDirty = draftSnapshot !== savedSnapshot;
  const colorPicker = buildProfileColorPickerModel({
    currentColor: draft.color,
    currentProfileId: currentProfile.id,
    profiles: data.profiles,
  });

  const workspaceOptions = workspaceRoutes
    .filter(
      (route) =>
        isPersistedWorkspace(route.id) &&
        (!route.ceoOnly || currentProfile.platformRole === "ceo"),
    )
    .map((route) => ({ value: route.id, label: route.label }));
  const viewOptions = viewTabs.map((item) => ({ value: item.id, label: item.label }));
  const assigneeOptions = [{ value: "Alle", label: "Alle Zuständigen" }, ...data.profiles.map((profile) => ({ value: profile.id, label: profile.name }))];
  const statusOptions = [{ value: "Alle", label: "Alle" }, ...taskStatuses.map((status) => ({ value: status, label: status }))];
  const priorityOptions = ["Alle", "P0", "P1", "P2", "P3", "P4"].map((priority) => ({ value: priority, label: priority }));
  const initiativeOptions = [{ value: "Alle", label: "Alle" }, ...initiativePlanningItems(data.tasks).map((initiative) => ({ value: initiative.id, label: initiative.title }))];
  const quickFilterOptions = quickFilters.map((item) => ({ value: item.id, label: item.label }));

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

  const toggleExpandedInitiative = (initiativeId: string) => {
    setMessage("");
    setDraft((current) => ({
      ...current,
      expandedInitiativeIds: current.expandedInitiativeIds.includes(initiativeId)
        ? current.expandedInitiativeIds.filter((item) => item !== initiativeId)
        : [...current.expandedInitiativeIds, initiativeId],
    }));
  };

  const save = async (resave = false) => {
    setMessage("");
    const colorPatch = buildProfileColorSavePatch({
      draftColor: draft.color,
      persistedColor: savedDraft.color,
      duplicateMode: colorPicker.duplicateMode,
    });
    try {
      await onSaveOwnProfileSettings({
        profilePatch: {
          focus: draft.focus,
          ...(colorPatch.color ? { color: colorPatch.color } : {}),
          notificationsEnabled: draft.notificationsEnabled,
        },
        profileColorDuplicateMode: colorPatch.profileColorDuplicateMode,
        notificationEvents: draft.notificationEvents,
        uiPreferences: {
          defaultWorkspace: draft.defaultWorkspace,
          defaultTaskView: draft.defaultTaskView,
          planningFilters: draft.planningFilters,
          expandedInitiativeIds: draft.expandedInitiativeIds,
        },
      }, editor, resave);
    } catch (error) {
      if (error instanceof ProfileColorConflictError) {
        setDraft((current) => restoreProfileColorAfterConflict(current, savedDraft.color));
      }
      return;
    }
    setSavedDraft(draft);
    setMessage(source === "supabase" ? "Gespeichert." : "Lokal gespeichert.");
  };

  return (
    <div className="min-w-0 pb-24">
      <div className="mb-4 flex gap-2 overflow-x-auto lg:hidden" aria-label="Profilbereiche">
        {visibleSections.map((section) => (
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
            {visibleSections.map((section) => (
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
              colorPicker={colorPicker}
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
              initiativeOptions={initiativeOptions}
              priorityOptions={priorityOptions}
              quickFilterOptions={quickFilterOptions}
              statusOptions={statusOptions}
              assigneeOptions={assigneeOptions}
              viewOptions={viewOptions}
              workspaceOptions={workspaceOptions}
              onAdvancedBoardOpenChange={setAdvancedBoardOpen}
              onDefaultTaskViewChange={(defaultTaskView) => updateDraft("defaultTaskView", defaultTaskView)}
              onDefaultWorkspaceChange={(defaultWorkspace) => updateDraft("defaultWorkspace", defaultWorkspace)}
              onInitiativeToggle={toggleExpandedInitiative}
              onPlanningFiltersChange={updatePlanningFilters}
            />
          )}
          {activeSection === "api" && operationalProfile && (
            <ProfilePlanningItemsTokens planningState={planningState} source={source} />
          )}
        </div>
      </div>

      {settings.save.phase === "conflict" && (
        <div className="mt-4 space-y-2" role="status">
          <UiNotice tone="warning">Das Profil wurde zwischenzeitlich geändert. Deine Eingaben bleiben erhalten. Prüfe den aktuellen Stand vor dem erneuten Speichern.</UiNotice>
          {editing.current && <p className="break-words text-sm text-slate-700">Aktueller Serverstand: Fokus: {editing.current.profile.focus || "leer"}; Farbe: {editing.current.profile.color || "Standard"}; Benachrichtigungen: {editing.current.profile.notificationsEnabled === false ? "aus" : "an"}; Startbereich: {editing.current.uiPreference?.defaultWorkspace || "planning"}; Aufgabenansicht: {editing.current.uiPreference?.defaultTaskView || "board"}.</p>}
          <UiButton className="min-h-11" onClick={() => { void editor.refreshConflict(); }} disabled={settings.save.checkStatus === "checking"}>Aktuellen Serverstand laden</UiButton>
          {editing.phase === "conflict" && <UiButton className="min-h-11" onClick={() => { void save(true); }} disabled={!editing.canResave || pending} variant="primary">Erneut speichern</UiButton>}
        </div>
      )}
      {settings.save.phase === "unconfirmed" && (
        <div className="mt-4" role="status">
          <UiNotice tone="warning">Die Speicherung ist noch nicht bestätigt. Deine abgesendeten Angaben bleiben erhalten. Der aktuelle Serverstand bestätigt diesen Speicherversuch nicht.</UiNotice>
          <UiButton className="mt-2 min-h-11" onClick={() => { void planningState.checkOwnProfileSettings(currentProfile.id); }} disabled={settings.save.checkStatus === "checking"}>Serverstand prüfen</UiButton>
          {settings.save.checkStatus === "checked" && <p className="mt-2 text-sm text-slate-700">Serverstand geprüft. Die Bestätigung bleibt offen.</p>}
          {settings.save.submitted && <details className="mt-2 text-sm text-slate-700"><summary>Abgesendete Angaben</summary><pre className="overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify(settings.save.submitted, null, 2)}</pre></details>}
        </div>
      )}
      {(isDirty || message) && (
        <div className="sticky bottom-4 z-10 mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white/95 px-4 py-3 shadow-lg backdrop-blur" data-profile-save-bar>
          <div className="text-sm font-semibold text-slate-700">
            {settings.save.phase === "unconfirmed" ? "Speicherbestätigung ausstehend" : isDirty ? "Ungespeicherte Änderungen" : message}
          </div>
          <div className="flex items-center gap-2">
            {isDirty && message && <UiNotice tone="success" size="compact">{message}</UiNotice>}
            {isDirty && (
              <UiButton onClick={() => { void save(); }} disabled={pending || confirmationPending || editing.phase === "conflict" || settings.readStatus === "forbidden"} variant="primary">
                Speichern
              </UiButton>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
