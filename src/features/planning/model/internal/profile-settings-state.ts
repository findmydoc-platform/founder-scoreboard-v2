import type { PlanningShellState } from "@/lib/types";
import type { OwnProfileSettingsConfirmation, OwnProfileSettingsPatch, ProfileSettingsResult, ProfileSettingsSaveView, ProfileSettingsView } from "@/features/profile/model/profile-settings-contract";
import type { PlanningReadStatus } from "../planning-state";

type Context = {
  confirmed(): PlanningShellState;
  update(data: PlanningShellState): void;
  changed(): void;
  active(): boolean;
  generation(): number;
  readStatus(): PlanningReadStatus;
  nextSequence(): number;
  refresh(): Promise<boolean>;
  acknowledge?: (tourId: string) => Promise<import("@/lib/types").ProfileFeatureTourAcknowledgement>;
  save?: (patch: OwnProfileSettingsPatch) => Promise<OwnProfileSettingsConfirmation>;
};
function upsert<T>(values: T[], saved: T, same: (item: T) => boolean) {
  return values.some(same) ? values.map(item => same(item) ? saved : item) : [...values, saved];
}
export function createProfileSettingsState(context: Context) {
  const tourSaves = new Map<string, { profileId: string; tourId: string; phase: "saving" | "saved" | "rejected" | "unconfirmed"; error: string }>();
  const saves = new Map<string, ProfileSettingsSaveView>();
  const confirmedAt = new Map<string, number>();
  const readAt = new Map<string, number>();
  const completeReadAt = new Map<string, number>();
  let denied = false;
  const owned = new Set<string>();
  const checks = new Map<string, Promise<boolean>>();
  function project(data: PlanningShellState): PlanningShellState {
    let next = data;
    for (const [profileId, save] of saves) {
      const patch = save.phase === "saving" || save.phase === "unconfirmed" ? save.submitted : null;
      if (!patch) continue;
      next = { ...next, profiles: next.profiles.map(profile => profile.id === profileId ? { ...profile, ...patch.profilePatch } : profile) };
      if (patch.uiPreferences) {
        const existing = next.profileUiPreferences.find(item => item.profileId === profileId);
        const preference = { profileId, ...patch.uiPreferences, createdAt: existing?.createdAt || "", updatedAt: existing?.updatedAt || "" };
        next = { ...next, profileUiPreferences: upsert(next.profileUiPreferences, preference, item => item.profileId === profileId) };
      }
      if (patch.notificationEvents) {
        let preferences = next.notificationPreferences;
        for (const [eventType, enabled] of Object.entries(patch.notificationEvents)) {
          const existing = preferences.find(item => item.profileId === profileId && item.channel === "google_chat" && item.eventType === eventType);
          preferences = upsert(preferences, { id: existing?.id || 0, profileId, channel: "google_chat", eventType, enabled }, item => item.profileId === profileId && item.channel === "google_chat" && item.eventType === eventType);
        }
        next = { ...next, notificationPreferences: preferences };
      }
    }
    return protect(next);
  }
  function protect(data: PlanningShellState) {
    if (!denied) return data;
    return { ...data, profiles: data.profiles.filter(item => !owned.has(item.id)), notificationPreferences: data.notificationPreferences.filter(item => !owned.has(item.profileId)), profileUiPreferences: data.profileUiPreferences.filter(item => !owned.has(item.profileId)), profileFeatureTourAcknowledgements: data.profileFeatureTourAcknowledgements.filter(item => !owned.has(item.profileId)) };
  }
  function view(profileId: string): ProfileSettingsView {
    owned.add(profileId);
    const active = context.active();
    const data = active ? project(context.confirmed()) : null;
    return {
      profile: data?.profiles.find(profile => profile.id === profileId) || null,
      uiPreference: data?.profileUiPreferences.find(item => item.profileId === profileId) || null,
      notificationPreferences: data?.notificationPreferences.filter(item => item.profileId === profileId) || [],
      acknowledgements: data?.profileFeatureTourAcknowledgements.filter(item => item.profileId === profileId) || [],
      tourSaves: active && !denied ? [...tourSaves.values()].filter(item => item.profileId === profileId).map(({ tourId, phase, error }) => ({ tourId, phase, error })) : [],
      readStatus: active ? denied ? "forbidden" : context.readStatus() : "not-loaded",
      save: active && !denied ? (saves.has(profileId) ? structuredClone(saves.get(profileId)!) : null) || { phase: "saved", submitted: null, error: "" } : { phase: "saved", submitted: null, error: "" },
    };
  }
  async function save(profileId: string, patch: OwnProfileSettingsPatch): Promise<ProfileSettingsResult> {
    if (!context.active()) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
    owned.add(profileId);
    const previous = saves.get(profileId);
    if (denied) return { ok: false, kind: "rejected", status: 403, error: "Profileinstellungen sind nicht verfügbar." };
    if (previous?.phase === "unconfirmed" || previous?.phase === "saving") return { ok: false, kind: "unconfirmed", error: "Die vorherige Speicherung ist noch nicht bestätigt." };
    const generation = context.generation();
    saves.set(profileId, { phase: "saving", submitted: structuredClone(patch), error: "" });
    context.changed();
    try {
      if (!context.save) throw new Error("Profileinstellungen konnten nicht gespeichert werden.");
      const result = await context.save(patch);
      if (!context.active() || context.generation() !== generation) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
      if (!result.profile || result.profile.id !== profileId) throw new Error("Die Speicherung ist noch nicht bestätigt.");
      const current = context.confirmed();
      let notificationPreferences = current.notificationPreferences;
      for (const saved of result.notificationPreferences) notificationPreferences = upsert(notificationPreferences, saved, item => item.profileId === saved.profileId && item.channel === saved.channel && item.eventType === saved.eventType);
      const confirmedSequence = context.nextSequence();
      confirmedAt.set(`profiles:${profileId}`, confirmedSequence);
      if (result.uiPreference) confirmedAt.set(`profileUiPreferences:${profileId}`, confirmedSequence);
      for (const saved of result.notificationPreferences) confirmedAt.set(`notificationPreferences:${saved.profileId}:${saved.channel}:${saved.eventType}`, confirmedSequence);
      context.update({ ...current,
        profiles: upsert(current.profiles, result.profile, profile => profile.id === profileId),
        profileUiPreferences: result.uiPreference ? upsert(current.profileUiPreferences, result.uiPreference, item => item.profileId === profileId) : current.profileUiPreferences,
        notificationPreferences,
      });
      saves.set(profileId, { phase: "saved", submitted: null, error: "" });
      context.changed();
      return { ok: true };
    } catch (error) {
      if (!context.active() || context.generation() !== generation) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
      const failure = error && typeof error === "object" ? error as { status?: number; code?: string } : {};
      const phase = failure.status && failure.status >= 400 && failure.status < 500 && failure.code !== "session_superseded" ? "rejected" : "unconfirmed";
      const kind = failure.code === "session_superseded" ? "sessionSuperseded" : phase;
      const message = error instanceof Error ? error.message : "Profil konnte nicht gespeichert werden.";
      saves.set(profileId, { phase, submitted: structuredClone(patch), error: message });
      context.changed();
      return { ok: false, kind, error: message, status: failure.status, code: failure.code };
    }
  }
  async function acknowledge(profileId: string, tourId: string): Promise<ProfileSettingsResult> {
    if (!context.active()) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
    owned.add(profileId);
    const key = `${profileId}:${tourId}`;
    const previous = tourSaves.get(key);
    if (previous?.phase === "saved") return { ok: true };
    if (previous?.phase === "unconfirmed" || previous?.phase === "saving") return { ok: false, kind: "unconfirmed", error: "Die Bestätigung der Hilfe-Tour steht noch aus." };
    const generation = context.generation();
    tourSaves.set(key, { profileId, tourId, phase: "saving", error: "" });
    context.changed();
    try {
      if (!context.acknowledge) throw new Error("Die Hilfe-Tour konnte nicht bestätigt werden.");
      const acknowledgement = await context.acknowledge(tourId);
      if (!context.active() || context.generation() !== generation) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
      if (acknowledgement.profileId !== profileId || acknowledgement.tourId !== tourId) throw new Error("Die Bestätigung der Hilfe-Tour steht noch aus.");
      const current = context.confirmed();
      confirmedAt.set(`profileFeatureTourAcknowledgements:${profileId}:${tourId}`, context.nextSequence());
      context.update({ ...current, profileFeatureTourAcknowledgements: upsert(current.profileFeatureTourAcknowledgements, acknowledgement, item => item.profileId === profileId && item.tourId === tourId) });
      tourSaves.set(key, { profileId, tourId, phase: "saved", error: "" });
      context.changed();
      return { ok: true };
    } catch (error) {
      if (!context.active() || context.generation() !== generation) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
      const failure = error && typeof error === "object" ? error as { status?: number; code?: string } : {};
      const status = failure.status;
      const phase = status && status >= 400 && status < 500 && failure.code !== "session_superseded" ? "rejected" : "unconfirmed";
      const kind = failure.code === "session_superseded" ? "sessionSuperseded" : phase;
      const message = error instanceof Error ? error.message : "Die Bestätigung der Hilfe-Tour steht noch aus.";
      tourSaves.set(key, { profileId, tourId, phase, error: message });
      context.changed();
      return { ok: false, kind, status, error: message };
    }
  }
  function check(profileId: string) {
    const previous = checks.get(profileId);
    if (previous) return previous;
    const generation = context.generation();
    const save = saves.get(profileId);
    if (save) saves.set(profileId, { ...save, checkStatus: "checking" });
    context.changed();
    const checking = context.refresh().then(ok => {
      if (!context.active() || context.generation() !== generation) return false;
      const latest = saves.get(profileId);
      if (latest) saves.set(profileId, { ...latest, checkStatus: denied ? "forbidden" : ok ? "checked" : "unavailable" });
      context.changed();
      return ok;
    }).finally(() => { if (checks.get(profileId) === checking) checks.delete(profileId); });
    checks.set(profileId, checking);
    return checking;
  }
  function acceptRead(incoming: PlanningShellState, coverage: import("./planning-read-scopes").PlanningReadCoverage, started: number) {
    const current = context.confirmed();
    let stale = false;
    function accept<T>(key: keyof PlanningShellState, before: T[], after: T[], identity: (item: T) => string) {
      if (!coverage[key]) return before;
      if ((completeReadAt.get(key) || 0) > started) { stale = true; return before; }
      const protectedIds = new Set(before.filter(item => Math.max(confirmedAt.get(`${key}:${identity(item)}`) || 0, readAt.get(`${key}:${identity(item)}`) || 0) > started).map(identity));
      if (protectedIds.size) stale = true;
      for (const item of after) if (!protectedIds.has(identity(item))) readAt.set(`${key}:${identity(item)}`, started);
      if (coverage[key] === "complete") completeReadAt.set(key, started);
      return [...after.filter(item => !protectedIds.has(identity(item))), ...before.filter(item => protectedIds.has(identity(item)))];
    }
    return { stale, data: { ...incoming,
      profiles: accept("profiles", current.profiles, incoming.profiles, item => item.id),
      notificationPreferences: accept("notificationPreferences", current.notificationPreferences, incoming.notificationPreferences, item => `${item.profileId}:${item.channel}:${item.eventType}`),
      profileUiPreferences: accept("profileUiPreferences", current.profileUiPreferences, incoming.profileUiPreferences, item => item.profileId),
      profileFeatureTourAcknowledgements: accept("profileFeatureTourAcknowledgements", current.profileFeatureTourAcknowledgements, incoming.profileFeatureTourAcknowledgements, item => `${item.profileId}:${item.tourId}`),
    } };
  }
  function preserveOwned(current: PlanningShellState): Partial<PlanningShellState> {
    return { profiles: current.profiles, notificationPreferences: current.notificationPreferences, profileUiPreferences: current.profileUiPreferences, profileFeatureTourAcknowledgements: current.profileFeatureTourAcknowledgements };
  }
  return { view, save, check, acknowledge, project, protect, acceptRead, preserveOwned, readStatus(status: PlanningReadStatus) { if (status === "forbidden") denied = true; else if (status === "current" || status === "stale") denied = false; }, clear() { tourSaves.clear(); saves.clear(); confirmedAt.clear(); readAt.clear(); completeReadAt.clear(); owned.clear(); checks.clear(); denied = false; } };
}
