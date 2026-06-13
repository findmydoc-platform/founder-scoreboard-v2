"use client";

import { CustomDatePicker } from "@/components/custom-date-picker";
import { CustomSelect } from "@/components/custom-select";
import { formatDate } from "@/lib/display";
import { googleChatDigestEventTypes, notificationEventLabel } from "@/lib/notification-policy";
import { roleLabel, taskBelongsToProfile } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import type { PlanningData, PlatformRole, Profile, Task } from "@/lib/types";

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

function profileColor(profile?: Pick<Profile, "color"> | null) {
  return profile?.color || "#64748b";
}

export function TeamOverview({
  data,
  tasks,
  pending,
  canManageTeam,
  currentProfileId,
  onUpdateProfile,
  onUpdateNotificationPreference,
}: {
  data: PlanningData;
  tasks: Task[];
  pending: boolean;
  canManageTeam: boolean;
  currentProfileId: string;
  onUpdateProfile: (profile: Profile, patch: Partial<Profile>) => void;
  onUpdateNotificationPreference: (profileId: string, eventType: string, enabled: boolean) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const activeDeputies = data.profiles.filter((profile) => {
    if (profile.platformRole !== "deputy") return false;
    if (profile.deputyActiveFrom && profile.deputyActiveFrom > today) return false;
    if (profile.deputyActiveUntil && profile.deputyActiveUntil < today) return false;
    return Boolean(profile.deputyFor);
  });

  return (
    <div className="grid gap-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Rollen & Vertretung</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
              CEO verwaltet Rollen, GitHub-Zuordnung, Deputy-Zeiträume, Google-Chat-Ziele und Kalender-Sync. Deputy bekommt operative Rechte, aber kein Decision-Log-Edit.
            </p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${canManageTeam ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
            {canManageTeam ? "CEO-Bearbeitung aktiv" : "Nur Ansicht"}
          </span>
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
      </section>

      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
      {data.profiles.map((profile) => {
        const ownedTasks = tasks.filter((task) => taskBelongsToProfile(task, profile));
        const openTasks = ownedTasks.filter((task) => normalizeStatus(task.status) !== "Erledigt");
        const highPriority = ownedTasks.filter((task) => ["P0", "P1"].includes(task.priority));
        const load = ownedTasks.reduce((sum, task) => sum + task.hours, 0);
        const isDeputy = profile.platformRole === "deputy";
        const canEditProfile = canManageTeam;
        const canEditNotificationEvents = canManageTeam || currentProfileId === profile.id;
        const enabledPreferenceCount = googleChatDigestEventTypes.filter((eventType) => {
          const preference = data.notificationPreferences.find((item) => item.profileId === profile.id && item.channel === "google_chat" && item.eventType === eventType);
          return preference?.enabled !== false;
        }).length;
        return (
          <article key={profile.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: profileColor(profile) }} />
                  <h2 className="text-base font-semibold text-slate-950">{profile.name}</h2>
                </div>
                <p className="mt-1 text-sm leading-5 text-slate-500">{profile.focus || "Kein Fokus hinterlegt."}</p>
                <p className="mt-1 text-xs text-slate-500">@{profile.githubLogin || "nicht gemappt"}</p>
              </div>
              <span className="rounded-full border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600">{roleLabel(profile)}</span>
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
                <div className="font-semibold text-slate-900">{profile.weeklyCapacity}h</div>
              </div>
            </div>
            <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-xs font-semibold text-slate-500">
                  Plattformrolle
                  <CustomSelect
                    value={profile.platformRole}
                    disabled={pending || !canEditProfile}
                    onChange={(value) => {
                      const platformRole = value as PlatformRole;
                      onUpdateProfile(profile, {
                        platformRole,
                        orgRole: platformRole === "ceo" ? "CEO" : platformRole === "founder" ? "Founder" : platformRole === "deputy" ? "Deputy" : "Viewer",
                        deputyFor: platformRole === "deputy" ? profile.deputyFor || data.profiles.find((item) => item.platformRole === "ceo")?.id || "" : "",
                        deputyActiveFrom: platformRole === "deputy" ? profile.deputyActiveFrom : "",
                        deputyActiveUntil: platformRole === "deputy" ? profile.deputyActiveUntil : "",
                      });
                    }}
                    className="h-9 text-sm"
                    options={platformRoleOptions.map((role) => ({ value: role, label: role === "ceo" ? "CEO" : role === "founder" ? "Founder" : role === "deputy" ? "Deputy" : "Viewer" }))}
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-500">
                  Org-Rolle
                  <input
                    value={profile.orgRole}
                    disabled={pending || !canEditProfile}
                    onChange={(event) => onUpdateProfile(profile, { orgRole: event.target.value })}
                    className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-800 disabled:opacity-60"
                  />
                </label>
              </div>
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                GitHub Login
                <input
                  value={profile.githubLogin}
                  disabled={pending || !canEditProfile}
                  onChange={(event) => onUpdateProfile(profile, { githubLogin: event.target.value })}
                  className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-800 disabled:opacity-60"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-xs font-semibold text-slate-500">
                  Google Chat User-ID
                  <input
                    value={profile.googleChatUserId || ""}
                    disabled={pending || !canEditProfile}
                    onChange={(event) => onUpdateProfile(profile, { googleChatUserId: event.target.value })}
                    className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-800 disabled:opacity-60"
                    placeholder="users/..."
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-500">
                  Google Chat DM-Space
                  <input
                    value={profile.googleChatDmSpace || ""}
                    disabled={pending || !canEditProfile}
                    onChange={(event) => onUpdateProfile(profile, { googleChatDmSpace: event.target.value })}
                    className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-800 disabled:opacity-60"
                    placeholder="spaces/..."
                  />
                </label>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                <span>
                  Google-Chat-Benachrichtigungen
                  <span className="mt-0.5 block text-[11px] font-normal text-slate-500">Deaktiviert verhindert Digest-Zustellung für dieses Profil.</span>
                </span>
                <input
                  type="checkbox"
                  checked={profile.notificationsEnabled !== false}
                  disabled={pending || !canEditProfile}
                  onChange={(event) => onUpdateProfile(profile, { notificationsEnabled: event.target.checked })}
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
                    checked={Boolean(profile.googleCalendarSyncEnabled)}
                    disabled={pending || !canEditProfile || !profile.googleCalendarEmail}
                    onChange={(event) => onUpdateProfile(profile, { googleCalendarSyncEnabled: event.target.checked })}
                    className="mt-1 h-4 w-4 rounded border-blue-300 text-blue-600 disabled:opacity-60"
                    aria-label="Google Calendar Sync aktivieren"
                  />
                </div>
                <label className="mt-3 grid gap-1 text-xs font-semibold text-blue-900">
                  Kalender-E-Mail
                  <input
                    value={profile.googleCalendarEmail || ""}
                    disabled={pending || !canEditProfile}
                    onChange={(event) => onUpdateProfile(profile, { googleCalendarEmail: event.target.value })}
                    className="h-9 rounded-md border border-blue-100 bg-white px-2 text-sm font-normal text-slate-800 disabled:opacity-60"
                    placeholder="name@findmydoc.eu"
                  />
                </label>
                <p className="mt-2 text-[11px] leading-4 text-blue-700">
                  Letzter Sync: {profile.googleCalendarLastSyncedAt ? formatDate(profile.googleCalendarLastSyncedAt) : "noch nicht synchronisiert"}
                </p>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-700">Google-Chat-Events</div>
                    <p className="mt-0.5 text-[11px] leading-4 text-slate-500">Feinsteuerung pro Ereignistyp. Ausgeschaltete Events bleiben in der App sichtbar.</p>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">{enabledPreferenceCount}/{googleChatDigestEventTypes.length}</span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {googleChatDigestEventTypes.map((eventType) => {
                    const preference = data.notificationPreferences.find((item) => item.profileId === profile.id && item.channel === "google_chat" && item.eventType === eventType);
                    const enabled = preference?.enabled !== false;
                    return (
                      <label key={eventType} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-2 text-[11px] font-semibold text-slate-600">
                        <span className="min-w-0 truncate">{notificationEventLabel(eventType)}</span>
                        <input
                          type="checkbox"
                          checked={enabled}
                          disabled={pending || profile.notificationsEnabled === false || !canEditNotificationEvents}
                          onChange={(event) => onUpdateNotificationPreference(profile.id, eventType, event.target.checked)}
                          className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 disabled:opacity-60"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Fokus
                <textarea
                  value={profile.focus || ""}
                  disabled={pending || !canEditProfile}
                  onChange={(event) => onUpdateProfile(profile, { focus: event.target.value })}
                  className="min-h-16 resize-y rounded-md border border-slate-200 bg-white px-2 py-2 text-sm font-normal text-slate-800 disabled:opacity-60"
                />
              </label>
              <div className="grid gap-2">
                <div className="text-xs font-semibold text-slate-500">Post-it-Farbe</div>
                <div className="flex flex-wrap gap-2">
                  {profileColorOptions.map((color) => {
                    const active = profileColor(profile).toLowerCase() === color.value.toLowerCase();
                    return (
                      <button
                        key={color.value}
                        type="button"
                        disabled={pending || !canEditProfile}
                        onClick={() => onUpdateProfile(profile, { color: color.value })}
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
                <label className="grid gap-1 text-xs font-semibold text-slate-500">
                  Kapazität
                  <input
                    type="number"
                    min={0}
                    max={80}
                    value={profile.weeklyCapacity}
                    disabled={pending || !canEditProfile}
                    onChange={(event) => onUpdateProfile(profile, { weeklyCapacity: Number(event.target.value) })}
                    className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-800 disabled:opacity-60"
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-500">
                  Vertreter für
                  <CustomSelect
                    value={profile.deputyFor || ""}
                    disabled={pending || !isDeputy || !canEditProfile}
                    onChange={(value) => onUpdateProfile(profile, { deputyFor: value })}
                    className="h-9 text-sm"
                    options={[{ value: "", label: "Keine Vertretung" }, ...data.profiles.filter((item) => item.platformRole === "ceo" || item.id === profile.deputyFor).map((item) => ({ value: item.id, label: item.name }))]}
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1 text-xs font-semibold text-slate-500">
                    Von
                    <CustomDatePicker value={profile.deputyActiveFrom || ""} disabled={pending || !isDeputy || !canEditProfile} onChange={(value) => onUpdateProfile(profile, { deputyActiveFrom: value })} className="h-9 text-sm" />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-500">
                    Bis
                    <CustomDatePicker value={profile.deputyActiveUntil || ""} disabled={pending || !isDeputy || !canEditProfile} onChange={(value) => onUpdateProfile(profile, { deputyActiveUntil: value })} className="h-9 text-sm" />
                  </label>
                </div>
              </div>
              <p className="text-xs leading-5 text-slate-500">
                Rollen, Stammdaten und der zentrale Benachrichtigungsschalter sind CEO-geschützt. Einzelne Google-Chat-Events kann das Profil selbst steuern.
              </p>
            </div>
          </article>
        );
      })}
      </div>
    </div>
  );
}
