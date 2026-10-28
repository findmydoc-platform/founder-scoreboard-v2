import type { Profile, ProfilePersistenceBasis, ProfileUiPreference } from "@/lib/types";
import type { OwnProfileEditingSnapshot, OwnProfileEditor, OwnProfileSettingsExpected, OwnProfileSettingsPatch, ProfileSettingsResult } from "@/features/profile/model/profile-settings-contract";
import type { TeamProfileEditor, TeamProfilePatch } from "../planning-team-state";
import { defaultFilters } from "@/features/profile/model/profile-settings-view-model";

const profileColumns = { focus: "focus", color: "profile_color", notificationsEnabled: "notifications_enabled", platformRole: "platform_role", orgRole: "org_role", weeklyCapacity: "weekly_capacity", deputyFor: "deputy_for", deputyActiveFrom: "deputy_active_from", deputyActiveUntil: "deputy_active_until" } as const;
const teamFields = ["platformRole", "orgRole", "weeklyCapacity", "deputyFor", "deputyActiveFrom", "deputyActiveUntil"] as const;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const sameField = (key: string, left: unknown, right: unknown) => key === "ui.expandedInitiativeIds" ? same(Array.isArray(left) ? [...left].sort() : left, Array.isArray(right) ? [...right].sort() : right) : same(left, right);
const copy = <T,>(value: T): T => structuredClone(value);
function normalizedProfileValue(profile: Profile, field: keyof typeof profileColumns) {
  if (field === "notificationsEnabled") return profile[field] !== false;
  if (field === "color") return profile[field] || "#64748b";
  return profile[field] ?? "";
}
export function profileBasis(profile: Profile, fields: readonly (keyof typeof profileColumns)[]): Record<string, unknown> {
  return Object.fromEntries(fields.map(field => {
    const column = profileColumns[field];
    return [column, profile.persistenceBasis && column in profile.persistenceBasis ? profile.persistenceBasis[column] : (profile[field] === "" || profile[field] === undefined) && !["platformRole", "orgRole"].includes(field) ? null : profile[field]];
  }));
}
export function uiBasis(preference: ProfileUiPreference | null): OwnProfileSettingsExpected["ui"] {
  return preference ? copy(preference.persistenceBasis || { default_workspace: preference.defaultWorkspace, default_task_view: preference.defaultTaskView, planning_filters: preference.planningFilters, expanded_item_ids: preference.expandedInitiativeIds }) : null;
}
function uiValues(preference: ProfileUiPreference | null) {
  return { defaultWorkspace: preference?.defaultWorkspace || "planning", defaultTaskView: preference?.defaultTaskView || "board", planningFilters: defaultFilters(preference?.planningFilters), expandedInitiativeIds: preference?.expandedInitiativeIds || [] };
}
function ownValues(snapshot: OwnProfileEditingSnapshot): Record<string, unknown> {
  const values: Record<string, unknown> = Object.fromEntries((["focus", "color", "notificationsEnabled"] as const).map(field => [`profile.${field}`, normalizedProfileValue(snapshot.profile, field)]));
  const ui = uiValues(snapshot.uiPreference);
  for (const [key, value] of Object.entries(ui)) if (key !== "planningFilters") values[`ui.${key}`] = value;
  for (const [key, value] of Object.entries(ui.planningFilters)) values[`filter.${key}`] = value;
  for (const preference of snapshot.notificationPreferences) if (preference.channel === "google_chat") values[`event.${preference.eventType}`] = preference.enabled;
  return values;
}
function inputValues(patch: OwnProfileSettingsPatch): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch.profilePatch || {}).filter(([, value]) => value !== undefined)) values[`profile.${key}`] = value;
  for (const [key, value] of Object.entries(patch.notificationEvents || {})) values[`event.${key}`] = value;
  for (const [key, value] of Object.entries(patch.uiPreferences || {})) if (key !== "planningFilters") values[`ui.${key}`] = value;
  for (const [key, value] of Object.entries(patch.uiPreferences?.planningFilters || {})) values[`filter.${key}`] = value;
  return values;
}
function valueAt(values: Record<string, unknown>, key: string) { return key.startsWith("event.") ? values[key] ?? true : values[key]; }

// Each session owns its displayed basis. Accepted shared data never silently rebases it.
function editingSession<Input, Current>(options: {
  shown: Current;
  active(): boolean;
  pending(): boolean;
  current(): Current | null;
  confirmed?(basis: Current): Current;
  values(current: Current): Record<string, unknown>;
  input(input: Input): Record<string, unknown>;
  refresh(): Promise<boolean>;
  submit(input: Input, intent: Map<string, unknown>, basis: Current, current: Current): Promise<ProfileSettingsResult>;
  conflict(input: Input): void;
  impliedKeys?(intent: Map<string, unknown>): string[];
  changed(): void;
}) {
  let opening = copy(options.shown);
  let basis = copy(opening);
  let reviewed: Current | null = null;
  let phase: ReturnType<OwnProfileEditor["view"]>["phase"] = "editing";
  let error = "";
  let closed = false;
  let busy = false;
  let priorInput: Record<string, unknown> | undefined;
  const intent = new Map<string, unknown>();
  const alive = () => !closed && options.active();
  async function refreshConflict() {
    if (!alive() || busy) return false;
    reviewed = null;
    options.changed();
    const ok = await options.refresh();
    if (!alive()) return false;
    reviewed = ok ? copy(options.current()) : null;
    options.changed();
    return Boolean(reviewed);
  }
  async function run(input: Input, resave: boolean): Promise<ProfileSettingsResult> {
    if (!alive()) return { ok: false, kind: "sessionSuperseded", error: "Die Bearbeitung wurde beendet." };
    if (busy || options.pending() || phase === "unconfirmed") return { ok: false, kind: "unconfirmed", error: "Die Speicherbestätigung steht noch aus." };
    if (phase === "conflict" && (!resave || !reviewed)) return { ok: false, kind: "versionConflict", code: "profile_revision_conflict", error: "Bitte den aktuellen Serverstand prüfen und bewusst erneut speichern." };
    if (resave && phase !== "conflict") return { ok: false, kind: "rejected", error: "Es liegt kein geprüfter Versionskonflikt vor." };
    const incoming = options.input(input);
    const originalValues = options.values(opening);
    if (priorInput) for (const key of Object.keys(priorInput)) if (!(key in incoming)) intent.delete(key);
    for (const [key, value] of Object.entries(incoming)) {
      if (!priorInput || !sameField(key, value, priorInput[key])) {
        if (sameField(key, value, valueAt(originalValues, key))) intent.delete(key); else intent.set(key, copy(value));
      }
    }
    priorInput = copy(incoming);
    if (resave) basis = copy(reviewed!);
    const current = options.current();
    if (!current) return { ok: false, kind: "rejected", status: 403, error: "Das Profil ist nicht mehr verfügbar." };
    const before = options.values(basis);
    const now = options.values(current);
    if ([...intent.keys(), ...options.impliedKeys?.(intent) || []].some(key => !sameField(key, valueAt(before, key), valueAt(now, key)))) {
      phase = "conflict";
      error = "Das Profil wurde zwischenzeitlich geändert. Deine Eingaben bleiben erhalten.";
      options.conflict(input);
      options.changed();
      await refreshConflict();
      return { ok: false, kind: "versionConflict", code: "profile_revision_conflict", error };
    }
    if (!intent.size) { phase = "saved"; options.changed(); return { ok: true }; }
    busy = true;
    phase = "saving";
    options.changed();
    const result = await options.submit(input, intent, basis, current);
    busy = false;
    if (!alive()) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt." };
    phase = result.ok ? "saved" : result.kind === "versionConflict" ? "conflict" : result.kind === "unconfirmed" || result.kind === "sessionSuperseded" ? "unconfirmed" : "rejected";
    error = result.ok ? "" : result.error;
    if (phase === "conflict") { options.conflict(input); await refreshConflict(); }
    if (result.ok) { basis = copy(options.confirmed ? options.confirmed(basis) : options.current() || current); opening = copy(basis); intent.clear(); priorInput = undefined; }
    options.changed();
    return result;
  }
  return {
    view: () => ({ phase: alive() ? phase : "ended" as const, current: alive() && reviewed ? copy(reviewed) : null, canResave: alive() && phase === "conflict" && Boolean(reviewed) && !busy, error }),
    save: (input: Input) => run(input, false), resave: (input: Input) => run(input, true), refreshConflict,
    close() { closed = true; reviewed = null; },
  };
}
export function createOwnProfileEditor(options: { shown: OwnProfileEditingSnapshot; current(): OwnProfileEditingSnapshot | null; confirmed?(basis: OwnProfileEditingSnapshot): OwnProfileEditingSnapshot; active(): boolean; pending(): boolean; refresh(): Promise<boolean>; save(patch: OwnProfileSettingsPatch): Promise<ProfileSettingsResult>; conflict(patch: OwnProfileSettingsPatch): void; changed(): void }): OwnProfileEditor {
  return editingSession({ ...options, values: ownValues, input: inputValues, submit(input, intent, basis, current) {
    const patch: OwnProfileSettingsPatch = { profilePatch: {}, notificationEvents: {}, expected: { profile: {}, events: {} } };
    const ui = uiValues(current.uiPreference);
    let hasUi = false;
    for (const [key, value] of intent) {
      const [group, field] = key.split(".");
      if (group === "profile") { Object.assign(patch.profilePatch!, { [field]: value }); Object.assign(patch.expected!.profile, profileBasis(basis.profile, [field as keyof typeof profileColumns])); }
      if (group === "event") { patch.notificationEvents![field] = value as boolean; patch.expected!.events[field] = basis.notificationPreferences.find(item => item.channel === "google_chat" && item.eventType === field)?.enabled ?? null; }
      if (group === "ui") { Object.assign(ui, { [field]: value }); hasUi = true; }
      if (group === "filter") { Object.assign(ui.planningFilters, { [field]: value }); hasUi = true; }
    }
    if (hasUi) { patch.uiPreferences = ui; patch.expected!.ui = uiBasis(current.uiPreference); }
    if ("color" in patch.profilePatch!) patch.profileColorDuplicateMode = input.profileColorDuplicateMode;
    return options.save(patch);
  } });
}
export function createTeamProfileEditor(options: { shown: Profile; current(): Profile | null; active(): boolean; pending(): boolean; refresh(): Promise<boolean>; save(patch: TeamProfilePatch, expected: Record<string, unknown>): Promise<ProfileSettingsResult>; conflict(patch: TeamProfilePatch): void; changed(): void }): TeamProfileEditor {
  return editingSession({ ...options, impliedKeys: intent => intent.has("platformRole") && intent.get("platformRole") !== "deputy" ? ["deputyFor", "deputyActiveFrom", "deputyActiveUntil"] : [], values: profile => Object.fromEntries(teamFields.map(field => [field, normalizedProfileValue(profile, field)])), input: patch => Object.fromEntries(teamFields.filter(field => field in patch).map(field => [field, patch[field]])), submit(_input, intent, basis) {
    const patch = Object.fromEntries(intent) as TeamProfilePatch;
    const fields = teamFields.filter(field => field in patch);
    if (patch.platformRole && patch.platformRole !== "deputy") for (const field of ["deputyFor", "deputyActiveFrom", "deputyActiveUntil"] as const) if (!fields.includes(field)) fields.push(field);
    return options.save(patch, profileBasis(basis, fields));
  } });
}
export function mergeProfileBasis(profile: Profile, saved: Partial<Profile>, fields: readonly (keyof typeof profileColumns)[]): ProfilePersistenceBasis | undefined {
  const basis = { ...profile.persistenceBasis };
  for (const field of fields) { const column = profileColumns[field]; if (saved.persistenceBasis && column in saved.persistenceBasis) Object.assign(basis, { [column]: saved.persistenceBasis[column] }); else if (profile.persistenceBasis && field in saved) Object.assign(basis, { [column]: saved[field] === "" || saved[field] === undefined ? null : saved[field] }); }
  return Object.keys(basis).length ? basis : undefined;
}
