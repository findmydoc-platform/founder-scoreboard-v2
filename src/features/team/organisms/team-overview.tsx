"use client";

import { useState } from "react";
import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { formatDate } from "@/lib/display";
import { googleChatDigestEventTypes, notificationEventLabel } from "@/lib/notification-policy";
import { roleLabel, taskBelongsToProfile } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import type { PlanningData, PlatformRole, Profile, Task } from "@/lib/types";
import { UiBadge, UiButton, UiField, UiPanel, UiTextArea, UiTextInput } from "@/shared/atoms/ui-primitives";

const platformRoleOptions: PlatformRole[] = ["ceo", "founder", "deputy", "viewer"];
const profileColorOptions = [
  { value: "#22c55e", label: "Mint" },
  { value: "#3b82f6", label: "Blau" },
  { value: "#f59e0b", label: "Gelb" },
  { value: "#8b5cf6", label: "Lila" },
  { value: "#ec4899", label: "Pink" },
  { value: "#14b8a6", label: "Türkis" },
  { value: "#ef4444", label: "Rot" },
  { value: "#64748b", label: "Schiefer" },
];

const profileDraftFields: Array<keyof Profile> = [
  "platformRole",
  "orgRole",
  "githubLogin",
  "googleChatUserId",
  "googleChatDmSpace",
  "notificationsEnabled",
  "googleCalendarSyncEnabled",
  "googleCalendarEmail",
  "focus",
  "color",
  "weeklyCapacity",
  "deputyFor",
  "deputyActiveFrom",
  "deputyActiveUntil",
];

type ProfileCardDraft = {
  profile: Partial<Profile>;
  notificationEvents: Record<string, boolean>;
};

function profileColor(profile?: Pick<Profile, "color"> | null) {
  return profile?.color || "#64748b";
}

function eventEnabled(data: PlanningData, profileId: string, eventType: string) {
  const preference = data.notificationPreferences.find((item) => item.profileId === profileId && item.channel === "google_chat" && item.eventType === eventType);
  return preference?.enabled !== false;
}

function sameProfileValue(left: unknown, right: unknown) {
  return (left ?? "") === (right ?? "");
}

export function TeamOverview({
  data,
  tasks,
  pending,
  canManageTeam,
  currentProfileId,
  onSaveProfileSettings,
}: {
  data: PlanningData;
  tasks: Task[];
  pending: boolean;
  canManageTeam: boolean;
  currentProfileId: string;
  onSaveProfileSettings: (profile: Profile, patch: Partial<Profile>, notificationEvents: Record<string, boolean>) => Promise<void>;
}) {
  const [drafts, setDrafts] = useState<Record<string, ProfileCardDraft>>({});
  const [savingProfileId, setSavingProfileId] = useState("");
  const [profileSaveMessage, setProfileSaveMessage] = useState("");
  const today = new Date().toISOString().slice(0, 10);
  const activeDeputies = data.profiles.filter((profile) => {
    if (profile.platformRole !== "deputy") return false;
    if (profile.deputyActiveFrom && profile.deputyActiveFrom > today) return false;
    if (profile.deputyActiveUntil && profile.deputyActiveUntil < today) return false;
    return Boolean(profile.deputyFor);
  });
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

  const isProfileDirty = (profile: Profile) => {
    const draft = drafts[profile.id];
    if (!draft) return false;
    const profileDirty = profileDraftFields.some((field) => field in draft.profile && !sameProfileValue(draft.profile[field], profile[field]));
    const eventsDirty = googleChatDigestEventTypes.some((eventType) =>
      eventType in draft.notificationEvents && draft.notificationEvents[eventType] !== eventEnabled(data, profile.id, eventType)
    );
    return profileDirty || eventsDirty;
  };

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

  return (
    <div className="grid gap-4">
      <UiPanel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Rollen & Vertretung</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
              CEO verwaltet Rollen, GitHub-Zuordnung, Deputy-Zeiträume, Google-Chat-Ziele und Kalender-Sync. Deputy bekommt operative Rechte, aber kein Decision-Log-Edit.
            </p>
          </div>
          <UiBadge tone={canManageTeam ? "emerald" : "slate"} size="md">
            {canManageTeam ? "CEO-Bearbeitung aktiv" : "Nur Ansicht"}
          </UiBadge>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {platformRoleOptions.map((role) => {
            const count = data.profiles.filter((profile) => profile.platformRole === role).length;
            return (
              <div key={role} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                <div className="text-xs font-semibold text-slate-500">{role === "ceo" ? "CEO" : role === "founder" ? "Founder" : role === "deputy" ? "Deputy" : "Viewer"}</div>
                <div className="mt-1 text-lg font-semibold text-slate-950">{count}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600">
          {activeDeputies.length ? (
            activeDeputies.map((profile) => {
              const represented = data.profiles.find((item) => item.id === profile.deputyFor);
              return (
                <div key={profile.id}>
                  <span className="font-semibold text-slate-800">{profile.name}</span> vertritt {represented?.name || profile.deputyFor} {profile.deputyActiveUntil ? `bis ${formatDate(profile.deputyActiveUntil)}` : "ohne Enddatum"}.
                </div>
              );
            })
          ) : (
            "Aktuell ist keine aktive Deputy-Vertretung gesetzt."
          )}
        </div>
      </UiPanel>

      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
      {data.profiles.map((profile) => {
        const draftProfile = draftFor(profile);
        const ownedTasks = tasks.filter((task) => taskBelongsToProfile(task, profile));
        const openTasks = ownedTasks.filter((task) => normalizeStatus(task.status) !== "Erledigt");
        const highPriority = ownedTasks.filter((task) => ["P0", "P1"].includes(task.priority));
        const load = ownedTasks.reduce((sum, task) => sum + task.hours, 0);
        const isDeputy = draftProfile.platformRole === "deputy";
        const canEditProfile = canManageTeam;
        const canEditNotificationEvents = canManageTeam || currentProfileId === profile.id;
        const enabledPreferenceCount = googleChatDigestEventTypes.filter((eventType) => draftEventEnabled(profile.id, eventType)).length;
        const dirty = isProfileDirty(profile);
        const saving = savingProfileId === profile.id;
        return (
          <UiPanel key={profile.id} as="article">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: profileColor(draftProfile) }} />
                  <h2 className="text-base font-semibold text-slate-950">{draftProfile.name}</h2>
                </div>
                <p className="mt-1 text-sm leading-5 text-slate-500">{draftProfile.focus || "Kein Fokus hinterlegt."}</p>
                <p className="mt-1 text-xs text-slate-500">@{draftProfile.githubLogin || "nicht gemappt"}</p>
              </div>
              <UiBadge tone="white">{roleLabel(draftProfile)}</UiBadge>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2 text-sm">
              <div className="rounded-md bg-slate-50 p-2">
                <div className="text-xs text-slate-500">Offen</div>
                <div className="font-semibold text-slate-900">{openTasks.length}</div>
              </div>
              <div className="rounded-md bg-slate-50 p-2">
                <div className="text-xs text-slate-500">Hoch</div>
                <div className="font-semibold text-slate-900">{highPriority.length}</div>
              </div>
              <div className="rounded-md bg-slate-50 p-2">
                <div className="text-xs text-slate-500">Last</div>
                <div className="font-semibold text-slate-900">{load}h</div>
              </div>
              <div className="rounded-md bg-slate-50 p-2">
                <div className="text-xs text-slate-500">Kap.</div>
                <div className="font-semibold text-slate-900">{draftProfile.weeklyCapacity}h</div>
              </div>
            </div>
            <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                <span className={`text-xs font-semibold ${dirty ? "text-amber-700" : "text-slate-500"}`}>
                  {dirty ? "Ungespeicherte Änderungen" : "Keine Änderungen"}
                </span>
                <div className="flex gap-2">
                  <UiButton
                    type="button"
                    disabled={!dirty || saving}
                    onClick={() => resetProfileDraft(profile.id)}
                    size="sm"
                  >
                    Zurücksetzen
                  </UiButton>
                  <UiButton
                    type="button"
                    disabled={!dirty || saving || pending}
                    onClick={() => void saveProfileDraft(profile)}
                    size="sm"
                    variant="primary"
                  >
                    {saving ? "Speichert..." : "Speichern"}
                  </UiButton>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <UiField>
                  Plattformrolle
                  <CustomSelect
                    value={draftProfile.platformRole}
                    disabled={saving || pending || !canEditProfile}
                    onChange={(value) => {
                      const platformRole = value as PlatformRole;
                      setProfileDraft(profile.id, {
                        platformRole,
                        orgRole: platformRole === "ceo" ? "CEO" : platformRole === "founder" ? "Founder" : platformRole === "deputy" ? "Deputy" : "Viewer",
                        deputyFor: platformRole === "deputy" ? draftProfile.deputyFor || data.profiles.find((item) => item.platformRole === "ceo")?.id || "" : "",
                        deputyActiveFrom: platformRole === "deputy" ? draftProfile.deputyActiveFrom : "",
                        deputyActiveUntil: platformRole === "deputy" ? draftProfile.deputyActiveUntil : "",
                      });
                    }}
                    className="h-9 text-sm"
                    options={platformRoleOptions.map((role) => ({ value: role, label: role === "ceo" ? "CEO" : role === "founder" ? "Founder" : role === "deputy" ? "Deputy" : "Viewer" }))}
                  />
                </UiField>
                <UiField>
                  Org-Rolle
                  <UiTextInput
                    value={draftProfile.orgRole}
                    disabled={saving || pending || !canEditProfile}
                    onChange={(event) => setProfileDraft(profile.id, { orgRole: event.target.value })}
                    textTone="muted"
                  />
                </UiField>
              </div>
              <UiField>
                GitHub Login
                <UiTextInput
                  value={draftProfile.githubLogin}
                  disabled={saving || pending || !canEditProfile}
                  onChange={(event) => setProfileDraft(profile.id, { githubLogin: event.target.value })}
                  textTone="muted"
                />
              </UiField>
              <div className="grid gap-3 sm:grid-cols-2">
                <UiField>
                  Google Chat User-ID
                  <UiTextInput
                    value={draftProfile.googleChatUserId || ""}
                    disabled={saving || pending || !canEditProfile}
                    onChange={(event) => setProfileDraft(profile.id, { googleChatUserId: event.target.value })}
                    textTone="muted"
                    placeholder="users/..."
                  />
                </UiField>
                <UiField>
                  Google Chat DM-Space
                  <UiTextInput
                    value={draftProfile.googleChatDmSpace || ""}
                    disabled={saving || pending || !canEditProfile}
                    onChange={(event) => setProfileDraft(profile.id, { googleChatDmSpace: event.target.value })}
                    textTone="muted"
                    placeholder="spaces/..."
                  />
                </UiField>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                <span>
                  Google-Chat-Benachrichtigungen
                  <span className="mt-0.5 block text-[11px] font-normal text-slate-500">Deaktiviert verhindert Digest-Zustellung für dieses Profil.</span>
                </span>
                <input
                  type="checkbox"
                  checked={draftProfile.notificationsEnabled !== false}
                  disabled={saving || pending || !canEditProfile}
                  onChange={(event) => setProfileDraft(profile.id, { notificationsEnabled: event.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 disabled:opacity-60"
                />
              </label>
              <div className="rounded-md border border-blue-100 bg-blue-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-blue-900">Google Calendar Sync</div>
                    <p className="mt-0.5 text-[11px] leading-4 text-blue-700">Aktiviert importiert Kalendertermine als schreibgeschützte Meeting-Finder-Blocker.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(draftProfile.googleCalendarSyncEnabled)}
                    disabled={saving || pending || !canEditProfile || !draftProfile.googleCalendarEmail}
                    onChange={(event) => setProfileDraft(profile.id, { googleCalendarSyncEnabled: event.target.checked })}
                    className="mt-1 h-4 w-4 rounded border-blue-300 text-blue-600 disabled:opacity-60"
                    aria-label="Google Calendar Sync aktivieren"
                  />
                </div>
                <UiField className="mt-3 text-blue-900">
                  Kalender-E-Mail
                  <UiTextInput
                    value={draftProfile.googleCalendarEmail || ""}
                    disabled={saving || pending || !canEditProfile}
                    onChange={(event) => setProfileDraft(profile.id, { googleCalendarEmail: event.target.value })}
                    borderTone="info"
                    textTone="muted"
                    placeholder="name@findmydoc.eu"
                  />
                </UiField>
                <p className="mt-2 text-[11px] leading-4 text-blue-700">
                  Letzter Sync: {draftProfile.googleCalendarLastSyncedAt ? formatDate(draftProfile.googleCalendarLastSyncedAt) : "noch nicht synchronisiert"}
                </p>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-700">Google-Chat-Events</div>
                    <p className="mt-0.5 text-[11px] leading-4 text-slate-500">Feinsteuerung pro Ereignistyp. Ausgeschaltete Events bleiben in der App sichtbar.</p>
                  </div>
                  <UiBadge size="xs">{enabledPreferenceCount}/{googleChatDigestEventTypes.length}</UiBadge>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {googleChatDigestEventTypes.map((eventType) => {
                    const enabled = draftEventEnabled(profile.id, eventType);
                    return (
                      <label key={eventType} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-2 text-[11px] font-semibold text-slate-600">
                        <span className="min-w-0 truncate">{notificationEventLabel(eventType)}</span>
                        <input
                          type="checkbox"
                          checked={enabled}
                          disabled={saving || pending || draftProfile.notificationsEnabled === false || !canEditNotificationEvents}
                          onChange={(event) => setNotificationDraft(profile.id, eventType, event.target.checked)}
                          className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 disabled:opacity-60"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
              <UiField>
                Fokus
                <UiTextArea
                  value={draftProfile.focus || ""}
                  disabled={saving || pending || !canEditProfile}
                  onChange={(event) => setProfileDraft(profile.id, { focus: event.target.value })}
                  textTone="muted"
                />
              </UiField>
              <div className="grid gap-2">
                <div className="text-xs font-semibold text-slate-500">Post-it-Farbe</div>
                <div className="flex flex-wrap gap-2">
                  {profileColorOptions.map((color) => {
                    const active = profileColor(draftProfile).toLowerCase() === color.value.toLowerCase();
                    return (
                      <button
                        key={color.value}
                        type="button"
                        disabled={saving || pending || !canEditProfile}
                        onClick={() => setProfileDraft(profile.id, { color: color.value })}
                        className={`grid h-8 w-8 place-items-center rounded-md border transition disabled:cursor-not-allowed disabled:opacity-60 ${active ? "border-slate-900 ring-2 ring-slate-200" : "border-slate-200 hover:border-slate-400"}`}
                        title={color.label}
                        aria-label={`${color.label} als Post-it-Farbe wählen`}
                      >
                        <span className="h-5 w-5 rounded-sm" style={{ backgroundColor: color.value }} />
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <UiField>
                  Kapazität
                  <UiTextInput
                    type="number"
                    min={0}
                    max={80}
                    value={draftProfile.weeklyCapacity}
                    disabled={saving || pending || !canEditProfile}
                    onChange={(event) => setProfileDraft(profile.id, { weeklyCapacity: Number(event.target.value) })}
                    textTone="muted"
                  />
                </UiField>
                <UiField>
                  Vertreter für
                  <CustomSelect
                    value={draftProfile.deputyFor || ""}
                    disabled={saving || pending || !isDeputy || !canEditProfile}
                    onChange={(value) => setProfileDraft(profile.id, { deputyFor: value })}
                    className="h-9 text-sm"
                    options={[{ value: "", label: "Keine Vertretung" }, ...data.profiles.filter((item) => item.platformRole === "ceo" || item.id === draftProfile.deputyFor).map((item) => ({ value: item.id, label: item.name }))]}
                  />
                </UiField>
                <div className="grid grid-cols-2 gap-2">
                  <UiField>
                    Von
                    <CustomDatePicker value={draftProfile.deputyActiveFrom || ""} disabled={saving || pending || !isDeputy || !canEditProfile} onChange={(value) => setProfileDraft(profile.id, { deputyActiveFrom: value })} className="h-9 text-sm" />
                  </UiField>
                  <UiField>
                    Bis
                    <CustomDatePicker value={draftProfile.deputyActiveUntil || ""} disabled={saving || pending || !isDeputy || !canEditProfile} onChange={(value) => setProfileDraft(profile.id, { deputyActiveUntil: value })} className="h-9 text-sm" />
                  </UiField>
                </div>
              </div>
              <p className="text-xs leading-5 text-slate-500">
                Rollen, Stammdaten und der zentrale Benachrichtigungsschalter sind CEO-geschützt. Einzelne Google-Chat-Events kann das Profil selbst steuern.
              </p>
            </div>
          </UiPanel>
        );
      })}
      </div>
      {profileSaveMessage && (
        <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-800">{profileSaveMessage}</div>
      )}
    </div>
  );
}
