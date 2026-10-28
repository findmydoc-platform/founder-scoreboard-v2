import { createOwnProfileEditor, createTeamProfileEditor, mergeProfileBasis, profileBasis, uiBasis } from "./profile-editing";
import type { Profile, PlanningShellState } from "@/lib/types";
import type { OwnProfileSettingsConfirmation, OwnProfileSettingsPatch, ProfileSettingsResult, ProfileSettingsSaveView, ProfileSettingsView } from "@/features/profile/model/profile-settings-contract";
import type { PlanningTeamView, TeamProfilePatch, TeamProfileSaveView } from "../planning-team-state";
import type { AppWorkspace } from "../workspace-routes";
import type { PlanningReadStatus } from "../planning-state";

type Context = {
  confirmed(): PlanningShellState;
  update(data: PlanningShellState): void;
  changed(): void;
  active(): boolean;
  generation(): number;
  initialWorkspace: AppWorkspace;
  readStatus(workspace?: "profile" | "team"): PlanningReadStatus;
  saveTeam?: (profileId: string, patch: TeamProfilePatch, expected: Record<string, unknown>) => Promise<Partial<Profile> & { id: string }>;
  refreshTeam(): Promise<boolean>;
  governanceAuthorityChanged(): void;
  nextSequence(): number;
  refresh(): Promise<boolean>;
  acknowledge?: (tourId: string) => Promise<import("@/lib/types").ProfileFeatureTourAcknowledgement>;
  save?: (patch: OwnProfileSettingsPatch) => Promise<OwnProfileSettingsConfirmation>;
};
function upsert<T>(values: T[], saved: T, same: (item: T) => boolean) {
  return values.some(same) ? values.map(item => same(item) ? saved : item) : [...values, saved];
}
const governanceFields = ["platformRole", "orgRole", "weeklyCapacity", "deputyFor", "deputyActiveFrom", "deputyActiveUntil"] as const;

export function createProfileSettingsState(context: Context) {
  const ceoDemotions = new Map<string, Set<string>>();
  const teamSaves = new Map<string, TeamProfileSaveView>();
  let teamMembers = context.initialWorkspace === "team" ? new Set(context.confirmed().profiles.map(profile => profile.id)) : undefined;
  let teamCompleteness: PlanningTeamView["completeness"] = teamMembers ? "complete" : "none";
  let teamDenied = false;
  const teamChecks = new Map<string, Promise<boolean>>();
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
    for (const save of teamDenied ? [] : teamSaves.values()) {
      const unresolved = save.phase === "saving" || save.phase === "unconfirmed";
      const awaitingTeamRead = save.phase === "saved" && save.followup !== "current" && save.followup !== "not-needed";
      if (!unresolved && !awaitingTeamRead) continue;
      const patch = save.submitted;
      next = { ...next, profiles: next.profiles.map(profile => profile.id === save.profileId && unresolved ? { ...profile, ...patch } : ceoDemotions.get(save.profileId)?.has(profile.id) && profile.platformRole === "ceo" ? { ...profile, platformRole: "founder", orgRole: profile.orgRole === "CEO" ? "Founder" : profile.orgRole } : profile) };
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
    patch = { ...patch, profilePatch: Object.fromEntries((["focus", "color", "notificationsEnabled"] as const).filter(field => patch.profilePatch && field in patch.profilePatch).map(field => [field, patch.profilePatch![field]])) };
    const previous = saves.get(profileId);
    if (denied) return { ok: false, kind: "rejected", status: 403, error: "Profileinstellungen sind nicht verfügbar." };
    if (previous?.phase === "unconfirmed" || previous?.phase === "saving") return { ok: false, kind: "unconfirmed", error: "Die vorherige Speicherung ist noch nicht bestätigt." };
    const generation = context.generation();
    const base = context.confirmed();
    const profile = base.profiles.find(item => item.id === profileId);
    if (!profile) return { ok: false, kind: "rejected", status: 403, error: "Das Profil ist nicht verfügbar." };
    patch = { ...patch, expected: patch.expected || { profile: profileBasis(profile, (["focus", "color", "notificationsEnabled"] as const).filter(field => field in (patch.profilePatch || {}))), ...(patch.uiPreferences ? { ui: uiBasis(base.profileUiPreferences.find(item => item.profileId === profileId) || null) } : {}), events: Object.fromEntries(Object.keys(patch.notificationEvents || {}).map(event => [event, base.notificationPreferences.find(item => item.profileId === profileId && item.channel === "google_chat" && item.eventType === event)?.enabled ?? null])) } };
    const submitted = { ...patch }; delete submitted.expected;
    saves.set(profileId, { phase: "saving", submitted: structuredClone(submitted), error: "" });
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
      const existingProfile = current.profiles.find(profile => profile.id === profileId);
      const savedFields: Partial<Profile> = {};
      for (const field of ["focus", "color", "notificationsEnabled"] as const) {
        if (patch.profilePatch && field in patch.profilePatch) {
          Object.assign(savedFields, { [field]: result.profile[field] });
          confirmedAt.set(`profiles:${profileId}:${field}`, confirmedSequence);
        }
      }
      if (result.uiPreference) confirmedAt.set(`profileUiPreferences:${profileId}`, confirmedSequence);
      for (const saved of result.notificationPreferences) confirmedAt.set(`notificationPreferences:${saved.profileId}:${saved.channel}:${saved.eventType}`, confirmedSequence);
      context.update({ ...current,
        profiles: upsert(current.profiles, existingProfile ? { ...existingProfile, ...savedFields, persistenceBasis: mergeProfileBasis(existingProfile, result.profile, (["focus", "color", "notificationsEnabled"] as const).filter(field => field in savedFields)) } : result.profile, profile => profile.id === profileId),
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
      const kind = failure.code === "session_superseded" ? "sessionSuperseded" : failure.code === "profile_revision_conflict" ? "versionConflict" : phase;
      const message = error instanceof Error ? error.message : "Profil konnte nicht gespeichert werden.";
      saves.set(profileId, { phase: kind === "versionConflict" ? "conflict" : phase, submitted: structuredClone(submitted), error: message });
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
  function team(): PlanningTeamView {
    const active = context.active();
    const data = active ? project(context.confirmed()) : null;
    return { profiles: active && !teamDenied ? [...teamMembers || []].flatMap(id => data?.profiles.find(profile => profile.id === id) || []) : [], readStatus: active ? teamDenied ? "forbidden" : context.readStatus("team") : "not-loaded", completeness: active && !teamDenied ? teamCompleteness : "none", saves: active && !teamDenied ? [...teamSaves.values()].map(save => structuredClone(save)) : [] };
  }
  async function saveTeam(profileId: string, input: TeamProfilePatch, expected?: Record<string, unknown>): Promise<ProfileSettingsResult> {
    if (!context.active()) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
    if (teamDenied) return { ok: false, kind: "rejected", status: 403, error: "Teamdaten sind nicht verfügbar." };
    const patch = Object.fromEntries(governanceFields.filter(field => field in input).map(field => [field, input[field]])) as TeamProfilePatch;
    const previous = teamSaves.get(profileId);
    if (previous?.phase === "saving" || previous?.phase === "unconfirmed") return { ok: false, kind: "unconfirmed", error: "Die vorherige Profiländerung ist noch nicht bestätigt." };
    const generation = context.generation();
    if (patch.platformRole === "ceo") ceoDemotions.set(profileId, new Set(context.confirmed().profiles.filter(profile => profile.id !== profileId && profile.platformRole === "ceo").map(profile => profile.id)));
    teamSaves.set(profileId, { profileId, phase: "saving", submitted: structuredClone(patch), error: "", followup: "not-needed" });
    context.changed();
    try {
      if (!context.saveTeam) throw new Error("Profil konnte nicht gespeichert werden.");
      const basisProfile = context.confirmed().profiles.find(profile => profile.id === profileId);
      if (!basisProfile) throw Object.assign(new Error("Das Profil ist nicht mehr verfügbar."), { status: 403 });
      const expectedFields = governanceFields.filter(field => field in patch);
      if (patch.platformRole && patch.platformRole !== "deputy") for (const field of ["deputyFor", "deputyActiveFrom", "deputyActiveUntil"] as const) if (!expectedFields.includes(field)) expectedFields.push(field);
      const saved = await context.saveTeam(profileId, patch, expected || profileBasis(basisProfile, expectedFields));
      if (!context.active() || context.generation() !== generation) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
      if (saved.id !== profileId) throw new Error("Die Profiländerung ist noch nicht bestätigt.");
      const current = context.confirmed();
      const existing = current.profiles.find(profile => profile.id === profileId);
      if (!existing) throw new Error("Das Profil ist nicht mehr verfügbar.");
      const confirmedSequence = context.nextSequence();
      const governance: TeamProfilePatch = {};
      for (const field of governanceFields) if (field in saved) {
        Object.assign(governance, { [field]: saved[field] });
        confirmedAt.set(`profiles:${profileId}:${field}`, confirmedSequence);
      }
      context.update({ ...current, profiles: upsert(current.profiles, { ...existing, ...governance, persistenceBasis: mergeProfileBasis(existing, saved, governanceFields.filter(field => field in governance)) }, profile => profile.id === profileId) });
      const acceptedSave: TeamProfileSaveView = { profileId, phase: "saved", submitted: structuredClone(patch), error: "", followup: "loading" };
      teamSaves.set(profileId, acceptedSave);
      if (["platformRole", "deputyFor", "deputyActiveFrom", "deputyActiveUntil"].some(field => field in patch)) context.governanceAuthorityChanged();
      context.changed();
      const refreshed = await context.refreshTeam();
      if (!context.active() || context.generation() !== generation) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
      if (teamSaves.get(profileId) !== acceptedSave) return { ok: true };
      const followup = teamDenied ? "forbidden" : !refreshed ? "unavailable" : context.readStatus("team") === "stale" ? "stale" : teamCompleteness === "complete" ? "current" : "partial";
      if (followup === "current") ceoDemotions.delete(profileId);
      teamSaves.set(profileId, { profileId, phase: "saved", submitted: followup === "current" ? null : structuredClone(patch), error: "", followup });
      context.changed();
      return { ok: true };
    } catch (error) {
      if (!context.active() || context.generation() !== generation) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
      const failure = error && typeof error === "object" ? error as { status?: number; code?: string } : {};
      const phase = failure.status && failure.status >= 400 && failure.status < 500 && failure.code !== "session_superseded" ? "rejected" : "unconfirmed";
      const message = error instanceof Error ? error.message : "Die Profiländerung ist noch nicht bestätigt.";
      if (phase === "rejected") ceoDemotions.delete(profileId);
      teamSaves.set(profileId, { profileId, phase: failure.code === "profile_revision_conflict" ? "conflict" : phase, submitted: structuredClone(patch), error: message, status: failure.status, followup: "not-needed" });
      if (failure.status === 403 || phase === "unconfirmed" && ["platformRole", "deputyFor", "deputyActiveFrom", "deputyActiveUntil"].some(field => field in patch)) context.governanceAuthorityChanged();
      context.changed();
      return { ok: false, kind: failure.code === "session_superseded" ? "sessionSuperseded" : failure.code === "profile_revision_conflict" ? "versionConflict" : phase, error: message, status: failure.status, code: failure.code };
    }
  }
  function checkTeam(profileId: string) {
    const previous = teamChecks.get(profileId);
    if (previous) return previous;
    const generation = context.generation();
    const save = teamSaves.get(profileId);
    if (save) teamSaves.set(profileId, { ...save, checkStatus: "checking" });
    context.changed();
    const checking = context.refreshTeam().then(ok => {
      if (!context.active() || context.generation() !== generation) return false;
      const latest = teamSaves.get(profileId);
      if (latest) {
        const followup = teamDenied ? "forbidden" : !ok ? "unavailable" : context.readStatus("team") === "stale" ? "stale" : teamCompleteness === "complete" ? "current" : "partial";
        if (latest.phase === "saved" && followup === "current") ceoDemotions.delete(profileId);
        teamSaves.set(profileId, { ...latest, checkStatus: teamDenied ? "forbidden" : ok ? "checked" : "unavailable", ...(latest.phase === "saved" ? { followup, submitted: followup === "current" ? null : latest.submitted } : {}) });
      }
      context.changed();
      return ok;
    }).finally(() => { if (teamChecks.get(profileId) === checking) teamChecks.delete(profileId); });
    teamChecks.set(profileId, checking);
    return checking;
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
  function acceptRead(incoming: PlanningShellState, coverage: import("./planning-read-scopes").PlanningReadCoverage, started: number, workspace: AppWorkspace, raw: PlanningShellState) {
    const current = context.confirmed();
    let stale = false;
    function accept<T>(key: keyof PlanningShellState, before: T[], after: T[], identity: (item: T) => string) {
      if (!coverage[key]) return before;
      if ((completeReadAt.get(key) || 0) > started) { stale = true; return before; }
      const protectedIds = new Set(before.filter(item => Math.max(confirmedAt.get(`${key}:${identity(item)}`) || 0, readAt.get(`${key}:${identity(item)}`) || 0) > started).map(identity));
      if (protectedIds.size) stale = true;
      for (const item of raw[key] as T[]) if (!protectedIds.has(identity(item))) readAt.set(`${key}:${identity(item)}`, started);
      if (coverage[key] === "complete") completeReadAt.set(key, started);
      return [...after.filter(item => !protectedIds.has(identity(item))), ...before.filter(item => protectedIds.has(identity(item)))];
    }
    if (workspace === "team" && coverage.profiles) {
      teamMembers = coverage.profiles === "complete" ? new Set() : new Set(teamMembers);
      raw.profiles.forEach(profile => teamMembers!.add(profile.id));
      teamCompleteness = coverage.profiles;
    }
    const data = { ...incoming,
      profiles: (() => {
        if (!coverage.profiles) return current.profiles;
        const values = new Map(current.profiles.map(profile => [profile.id, profile]));
        for (const profile of raw.profiles) {
          const previous = values.get(profile.id);
          const next = { ...previous, ...profile };
          const acceptedBusinessFields: ("focus" | "color" | "notificationsEnabled" | typeof governanceFields[number])[] = [];
          for (const field of Object.keys(profile).filter(field => field !== "persistenceBasis") as (keyof Profile)[]) {
            const key = `profiles:${profile.id}:${field}`;
            if (Math.max(confirmedAt.get(key) || 0, readAt.get(key) || 0) > started) { Object.assign(next, { [field]: previous?.[field] }); stale = true; }
            else { readAt.set(key, started); if (["focus", "color", "notificationsEnabled", ...governanceFields].includes(field)) acceptedBusinessFields.push(field as typeof acceptedBusinessFields[number]); }
          }
          next.persistenceBasis = mergeProfileBasis(previous || profile, profile, acceptedBusinessFields);
          values.set(profile.id, next);
        }
        return [...values.values()];
      })(),
      notificationPreferences: accept("notificationPreferences", current.notificationPreferences, incoming.notificationPreferences, item => `${item.profileId}:${item.channel}:${item.eventType}`),
      profileUiPreferences: accept("profileUiPreferences", current.profileUiPreferences, incoming.profileUiPreferences, item => item.profileId),
      profileFeatureTourAcknowledgements: accept("profileFeatureTourAcknowledgements", current.profileFeatureTourAcknowledgements, incoming.profileFeatureTourAcknowledgements, item => `${item.profileId}:${item.tourId}`),
    };
    return { stale, data };
  }
  function beginOwnEdit(shown: import("@/features/profile/model/profile-settings-contract").OwnProfileEditingSnapshot) {
    const generation = context.generation();
    const profileId = shown.profile.id;
    owned.add(profileId);
    return createOwnProfileEditor({ shown, pending: () => ["saving", "unconfirmed"].includes(saves.get(profileId)?.phase || ""), active: () => context.active() && context.generation() === generation && !denied, current: () => {
      const data = context.confirmed();
      const profile = data.profiles.find(item => item.id === profileId);
      return profile ? { profile, uiPreference: data.profileUiPreferences.find(item => item.profileId === profileId) || null, notificationPreferences: data.notificationPreferences.filter(item => item.profileId === profileId) } : null;
    }, refresh: async () => await check(profileId) && context.readStatus("profile") === "current", save: patch => save(profileId, patch), changed: context.changed,
    conflict: patch => { const submitted = { ...patch }; delete submitted.expected; saves.set(profileId, { phase: "conflict", submitted: structuredClone(submitted), error: "Das Profil wurde zwischenzeitlich geändert. Deine Eingaben bleiben erhalten." }); },
    });
  }
  function beginTeamEdit(shown: Profile) {
    const generation = context.generation();
    return createTeamProfileEditor({ shown, pending: () => ["saving", "unconfirmed"].includes(teamSaves.get(shown.id)?.phase || ""), active: () => context.active() && context.generation() === generation && !teamDenied, current: () => context.confirmed().profiles.find(profile => profile.id === shown.id) || null,
      refresh: async () => await checkTeam(shown.id) && context.readStatus("team") === "current" && teamCompleteness === "complete", save: (patch, expected) => saveTeam(shown.id, patch, expected), changed: context.changed,
      conflict: patch => teamSaves.set(shown.id, { profileId: shown.id, phase: "conflict", submitted: structuredClone(patch), error: "Das Profil wurde zwischenzeitlich geändert. Deine Eingaben bleiben erhalten.", followup: "not-needed" }),
    });
  }
  function acceptAdministrationPeople(people: readonly ({ id: string } & Partial<Pick<Profile, "name" | "platformRole" | "orgRole" | "githubLogin">>)[], started: number) {
    const byId = new Map(people.map(person => [person.id, person]));
    const current = context.confirmed();
    context.update({ ...current, profiles: current.profiles.map(profile => {
      const actual = byId.get(profile.id); if (!actual) return profile;
      const next = { ...profile };
      for (const field of ["name", "platformRole", "orgRole", "githubLogin"] as const) {
        if (!(field in actual) || Math.max(confirmedAt.get(`profiles:${profile.id}:${field}`) || 0, readAt.get(`profiles:${profile.id}:${field}`) || 0) > started) continue;
        Object.assign(next, { [field]: actual[field] });
        if (next.persistenceBasis && (field === "platformRole" || field === "orgRole")) {
          next.persistenceBasis = { ...next.persistenceBasis };
          delete next.persistenceBasis[field === "platformRole" ? "platform_role" : "org_role"];
        }
        readAt.set(`profiles:${profile.id}:${field}`, started);
      }
      return next;
    }) });
  }
  function preserveOwned(current: PlanningShellState): Partial<PlanningShellState> {
    return { profiles: current.profiles, notificationPreferences: current.notificationPreferences, profileUiPreferences: current.profileUiPreferences, profileFeatureTourAcknowledgements: current.profileFeatureTourAcknowledgements };
  }
  return { acceptAdministrationPeople, view, save, check, acknowledge, beginOwnEdit, beginTeamEdit, team, saveTeam, checkTeam, project, protect, acceptRead, preserveOwned, hydrate(data: PlanningShellState, workspace: AppWorkspace) { if (workspace === "team") { teamMembers = new Set(data.profiles.map(profile => profile.id)); teamCompleteness = "complete"; } }, readStatus(status: PlanningReadStatus, workspace: AppWorkspace) { if (workspace === "profile") { if (status === "forbidden") denied = true; else if (status === "current" || status === "stale") denied = false; } if (workspace === "team") { if (status === "forbidden") teamDenied = true; else if (status === "current" || status === "stale") teamDenied = false; } }, clear() { ceoDemotions.clear(); teamSaves.clear(); teamChecks.clear(); teamMembers = undefined; teamCompleteness = "none"; teamDenied = false; tourSaves.clear(); saves.clear(); confirmedAt.clear(); readAt.clear(); completeReadAt.clear(); owned.clear(); checks.clear(); denied = false; } };
}
