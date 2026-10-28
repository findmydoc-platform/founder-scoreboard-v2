import { defaultFilters } from "@/features/profile/model/profile-settings-view-model";
import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData, readyHeaderSlot } from "@/lib/planning-header-data";
import type { Profile, Task } from "@/lib/types";

const ceo = { id: "ceo", name: "Ada", platformRole: "ceo", orgRole: "CEO", focus: "Before", weeklyCapacity: 20 } as Profile;
const founder = { ...ceo, id: "founder", name: "Bea", platformRole: "founder", orgRole: "Founder" } as Profile;
const task = { id: "task", title: "Before", updatedAt: "r1" } as Task;
const initial = { ...emptyPlanningShellState, profiles: [ceo, founder], tasks: [task] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("Team governance uses common profiles, keeps CEO side effects optimistic until an authoritative Team read and updates all loaded presentations", async () => {
  const write = deferred<Partial<Profile> & { id: string }>();
  const read = deferred<typeof initial>();
  const { planning } = createPlanningState({ userId: "account", initialData: initial, initialWorkspace: "team", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: await read.promise, coverage: { profiles: "complete", profileUiPreferences: "complete", notificationPreferences: "complete" } }), saveTeamProfile: () => write.promise,
  } });
  const saving = planning.saveTeamProfile(founder.id, { platformRole: "ceo", orgRole: "CEO" });
  expect(planning.team().profiles).toMatchObject([{ id: ceo.id, platformRole: "founder" }, { id: founder.id, platformRole: "ceo" }]);
  expect(planning.protectedCache()?.profiles).toMatchObject([{ id: ceo.id, platformRole: "ceo" }, { id: founder.id, platformRole: "founder" }]);
  write.resolve({ id: founder.id, platformRole: "ceo", orgRole: "CEO" });
  await Promise.resolve();
  expect(planning.protectedCache()?.profiles.find(profile => profile.id === ceo.id)?.platformRole).toBe("ceo");
  read.resolve({ ...initial, profiles: [{ ...ceo, platformRole: "founder", orgRole: "Founder" }, { ...founder, platformRole: "ceo", orgRole: "CEO" }] });
  await expect(saving).resolves.toMatchObject({ ok: true });
  expect(planning.team()).toMatchObject({ readStatus: "current", completeness: "complete" });
  expect(planning.profileSettings(ceo.id).profile?.platformRole).toBe("founder");
  expect(planning.protectedCache()?.profiles.find(profile => profile.id === ceo.id)?.platformRole).toBe("founder");
});

test("partial Team membership and a complete empty Team result never erase independently loaded profile identities", async () => {
  let data = { ...initial, profiles: [founder] };
  let completeness: "partial" | "complete" = "partial";
  const { planning } = createPlanningState({ userId: "account", initialData: initial, initialWorkspace: "profile", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data, coverage: { profiles: completeness } }),
  } });
  expect(planning.team()).toMatchObject({ profiles: [], readStatus: "not-loaded", completeness: "none" });
  await planning.refreshWorkspace("team");
  expect(planning.team()).toMatchObject({ profiles: [{ id: founder.id }], completeness: "partial" });
  expect(planning.profileSettings(ceo.id).profile?.name).toBe("Ada");
  data = { ...initial, profiles: [] };
  completeness = "complete";
  await planning.refreshWorkspace("team");
  expect(planning.team()).toMatchObject({ profiles: [], completeness: "complete" });
  expect(planning.profileSettings(ceo.id).profile?.name).toBe("Ada");
});

test("a delayed own-settings acknowledgement does not replace independently confirmed Team governance fields", async () => {
  const own = deferred<{ profile: Profile; notificationPreferences: [] }>();
  const { planning } = createPlanningState({ userId: "account", initialData: initial, initialWorkspace: "team", adapter: {
    saveTask: async () => ({ task }),
    readWorkspace: async () => ({ data: { ...initial, profiles: [{ ...ceo, focus: "Confirmed own", weeklyCapacity: 30 }, founder] } }),
    saveTeamProfile: async () => ({ id: ceo.id, weeklyCapacity: 30 }), saveOwnProfileSettings: () => own.promise,
  } });
  const savingOwn = planning.saveOwnProfileSettings(ceo.id, { profilePatch: { focus: "Confirmed own" } });
  await planning.saveTeamProfile(ceo.id, { weeklyCapacity: 30 });
  own.resolve({ profile: { ...ceo, focus: "Confirmed own" }, notificationPreferences: [] });
  await savingOwn;
  expect(planning.profileSettings(ceo.id).profile).toMatchObject({ focus: "Confirmed own", weeklyCapacity: 30 });
  expect(planning.team().profiles.find(profile => profile.id === ceo.id)).toMatchObject({ focus: "Confirmed own", weeklyCapacity: 30 });
});

test("an own-settings confirmation protects only its fields from a delayed Team read", async () => {
  const read = deferred<typeof initial>();
  const { planning } = createPlanningState({ userId: "account", initialData: initial, initialWorkspace: "team", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: await read.promise, coverage: { profiles: "complete", profileUiPreferences: "complete", notificationPreferences: "complete" } }),
    saveTeamProfile: async () => ({ id: ceo.id, weeklyCapacity: 30 }),
    saveOwnProfileSettings: async () => ({ profile: { ...ceo, focus: "Confirmed own", weeklyCapacity: 35 }, notificationPreferences: [] }),
  } });
  const savingTeam = planning.saveTeamProfile(ceo.id, { weeklyCapacity: 30 });
  await Promise.resolve();
  await planning.saveOwnProfileSettings(ceo.id, { profilePatch: { focus: "Confirmed own" } });
  read.resolve({ ...initial, profiles: [{ ...ceo, weeklyCapacity: 35 }, founder] });
  await savingTeam;
  expect(planning.profileSettings(ceo.id).profile).toMatchObject({ focus: "Confirmed own", weeklyCapacity: 35 });
  expect(planning.team().readStatus).toBe("stale");
});

test("rejecting a Team edit preserves a concurrent own-settings confirmation, preferences and independent task changes", async () => {
  const rejected = deferred<Partial<Profile> & { id: string }>();
  const { planning } = createPlanningState({ userId: "account", initialData: initial, initialWorkspace: "team", adapter: {
    saveTask: async () => ({ task: { ...task, title: "Independent", updatedAt: "r2" } }), readWorkspace: async () => ({ data: initial }), saveTeamProfile: () => rejected.promise,
    saveOwnProfileSettings: async () => ({ profile: { ...ceo, focus: "Confirmed own" }, notificationPreferences: [] }),
  } });
  const saving = planning.saveTeamProfile(founder.id, { weeklyCapacity: 35 });
  await planning.saveOwnProfileSettings(ceo.id, { profilePatch: { focus: "Confirmed own" } });
  await planning.saveTask(task, { title: "Independent" });
  rejected.reject(Object.assign(new Error("Only the CEO"), { status: 403 }));
  await expect(saving).resolves.toMatchObject({ ok: false, kind: "rejected", status: 403 });
  expect(planning.team().profiles.find(profile => profile.id === founder.id)?.weeklyCapacity).toBe(20);
  expect(planning.profileSettings(ceo.id).profile?.focus).toBe("Confirmed own");
  expect(planning.taskDetail(task.id).task?.title).toBe("Independent");
});

test("a lost Team save keeps the submission and a matching safe read cannot confirm it or repeat the write", async () => {
  let writes = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: initial, initialWorkspace: "team", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: { ...initial, profiles: [ceo, { ...founder, weeklyCapacity: 35 }] } }),
    saveTeamProfile: async () => { writes++; throw new Error("Lost response"); },
  } });
  await expect(planning.saveTeamProfile(founder.id, { weeklyCapacity: 35 })).resolves.toMatchObject({ ok: false, kind: "unconfirmed" });
  await planning.checkTeamProfile(founder.id);
  expect(planning.team().saves).toMatchObject([{ profileId: founder.id, phase: "unconfirmed", submitted: { weeklyCapacity: 35 }, checkStatus: "checked" }]);
  await expect(planning.saveTeamProfile(founder.id, { weeklyCapacity: 40 })).resolves.toMatchObject({ ok: false, kind: "unconfirmed" });
  expect(writes).toBe(1);
});

test.each([null, "other-account"])("Team operations and membership cannot publish after session replacement (%s)", async account => {
  const write = deferred<Partial<Profile> & { id: string }>();
  let replace!: (account: string | null) => void;
  const { planning } = createPlanningState({ userId: "account", initialData: initial, initialWorkspace: "team", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: initial }), saveTeamProfile: () => write.promise,
    subscribeSession: listener => { replace = listener; return () => {}; },
  } });
  const saving = planning.saveTeamProfile(founder.id, { weeklyCapacity: 35 });
  replace(account);
  write.resolve({ id: founder.id, weeklyCapacity: 35 });
  await expect(saving).resolves.toMatchObject({ ok: false, kind: "sessionSuperseded" });
  expect(planning.team()).toMatchObject({ profiles: [], saves: [], readStatus: "not-loaded", completeness: "none" });
});

test("Team editing cannot optimistically publish fields outside its existing governance contract", async () => {
  const write = deferred<Partial<Profile> & { id: string }>();
  let submitted: unknown;
  const { planning } = createPlanningState({ userId: "account", initialData: initial, initialWorkspace: "team", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: initial }),
    saveTeamProfile: async (_id, patch) => { submitted = patch; return write.promise; },
  } });
  const saving = planning.saveTeamProfile(founder.id, { weeklyCapacity: 35, focus: "Outside contract" } as never);
  expect(planning.team().profiles.find(profile => profile.id === founder.id)?.focus).toBe("Before");
  expect(submitted).toEqual({ weeklyCapacity: 35 });
  write.resolve({ id: founder.id, weeklyCapacity: 35 });
  await saving;
});

test("a denied Team scope stays withheld during rechecks while independently authorized own-profile data remains usable", async () => {
  let denied = true;
  const read = deferred<typeof initial>();
  const { planning } = createPlanningState({ userId: "account", initialData: initial, initialWorkspace: "team", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => { if (denied) throw Object.assign(new Error("Denied"), { status: 403 }); return { data: await read.promise }; },
  } });
  await planning.refreshWorkspace("team");
  expect(planning.team()).toMatchObject({ profiles: [], saves: [], readStatus: "forbidden" });
  expect(planning.profileSettings(ceo.id).profile?.name).toBe("Ada");
  denied = false;
  const checking = planning.refreshWorkspace("team");
  expect(planning.team()).toMatchObject({ profiles: [], readStatus: "forbidden" });
  read.resolve(initial);
  await checking;
  expect(planning.team()).toMatchObject({ profiles: [{ id: ceo.id }, { id: founder.id }], readStatus: "current" });
});

test("a Team business 409 is a rejection, preserves submitted fields and does not silently resubmit", async () => {
  let writes = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: initial, initialWorkspace: "team", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: initial }),
    saveTeamProfile: async () => { writes++; throw Object.assign(new Error("Genau ein CEO muss gesetzt bleiben."), { status: 409 }); },
  } });
  await expect(planning.saveTeamProfile(ceo.id, { platformRole: "founder" })).resolves.toMatchObject({ ok: false, kind: "rejected", status: 409 });
  await planning.checkTeamProfile(ceo.id);
  expect(planning.team().saves).toMatchObject([{ phase: "rejected", submitted: { platformRole: "founder" }, checkStatus: "checked" }]);
  expect(writes).toBe(1);
});

test.each([false, true])("a confirmed or uncertain authority-changing governance write withholds the former lead notification scope and discards old reads (%s)", async unknown => {
  const event = { id: 7, title: "Lead-only alert", status: "pending", recipientProfileId: "", actorProfileId: "", entityId: "task", entityType: "task", type: "task_changed", body: "", createdAt: "2026-10-28", seenAt: "", dismissedAt: "", resolvedAt: "", resolutionReason: "" } as import("@/lib/types").NotificationEvent;
  const oldHeader = { ...emptyPlanningHeaderData, notifications: readyHeaderSlot({ unreadCount: 9, items: [event] }) };
  const oldRead = deferred<typeof oldHeader>();
  const freshRead = deferred<typeof oldHeader>();
  let headerReads = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: { ...initial, notificationEvents: [event] }, initialWorkspace: "notifications", initialHeaderData: oldHeader, adapter: {
    saveTask: async () => ({ task }),
    readWorkspace: async workspace => workspace === "team" ? { data: initial } : new Promise(() => {}),
    readHeader: () => ++headerReads === 1 ? oldRead.promise : freshRead.promise,
    saveTeamProfile: async () => { if (unknown) throw new Error("Lost response"); return { id: founder.id, platformRole: "ceo" }; },
  } });
  await planning.refreshWorkspace("team");
  const older = planning.refreshHeader(["notifications"]);
  await planning.saveTeamProfile(founder.id, { platformRole: "ceo" });
  expect(planning.header().data.notifications.data.items).toEqual([]);
  expect(planning.notifications().events).toEqual([]);
  freshRead.resolve({ ...emptyPlanningHeaderData, notifications: readyHeaderSlot({ unreadCount: 0, items: [] }) });
  await planning.refreshHeader(["notifications"]);
  oldRead.resolve(oldHeader);
  await older;
  expect(planning.header().data.notifications.data.items).toEqual([]);
});


test("an editor retains its displayed basis, stops a known overlap and requires a conscious rebase", async () => {
  let writes = 0;
  let data = initial;
  let sent: unknown;
  const { planning } = createPlanningState({ userId: "account", initialData: initial, initialWorkspace: "team", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data, coverage: { profiles: "complete", profileUiPreferences: "complete", notificationPreferences: "complete" } }),
    saveOwnProfileSettings: async patch => { writes++; sent = patch; return { profile: { ...ceo, ...patch.profilePatch }, notificationPreferences: [] }; },
  } });
  const editor = planning.beginOwnProfileEdit({ profile: ceo, uiPreference: null, notificationPreferences: [] });
  data = { ...initial, profiles: [{ ...ceo, focus: "Foreign" }, founder] };
  await planning.refreshWorkspace("team");
  await expect(editor.save({ profilePatch: { focus: "Draft" } })).resolves.toMatchObject({ ok: false, kind: "versionConflict" });
  expect(writes).toBe(0);
  expect(editor.view()).toMatchObject({ phase: "conflict", current: { profile: { focus: "Foreign" } }, canResave: true });
  await expect(editor.resave({ profilePatch: { focus: "Draft" } })).resolves.toMatchObject({ ok: true });
  expect(writes).toBe(1);
  expect(sent).toMatchObject({ expected: { profile: { focus: "Foreign" } } });
});

test("an editor submits only dirty fields and preserves unrelated accepted preferences", async () => {
  const preference = { profileId: ceo.id, defaultWorkspace: "planning", defaultTaskView: "board", planningFilters: defaultFilters(), expandedInitiativeIds: [], createdAt: "", updatedAt: "" } as import("@/lib/types").ProfileUiPreference;
  let data = { ...initial, profileUiPreferences: [preference] };
  let sent: unknown;
  const { planning } = createPlanningState({ userId: "account", initialData: data, initialWorkspace: "profile", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data, coverage: { profiles: "complete", profileUiPreferences: "complete", notificationPreferences: "complete" } }),
    saveOwnProfileSettings: async patch => { sent = patch; return { profile: { ...ceo, ...patch.profilePatch }, notificationPreferences: [] }; },
  } });
  const editor = planning.beginOwnProfileEdit({ profile: ceo, uiPreference: preference, notificationPreferences: [] });
  data = { ...data, profiles: [{ ...ceo, color: "#f00" }, founder], profileUiPreferences: [{ ...preference, planningFilters: { ...preference.planningFilters, sort: "title" } }] };
  await planning.refreshWorkspace("profile");
  await editor.save({ profilePatch: { focus: "Draft", color: ceo.color }, uiPreferences: { ...preference, planningFilters: { ...preference.planningFilters, query: "mine" } } });
  expect(sent).toMatchObject({ profilePatch: { focus: "Draft" }, uiPreferences: { planningFilters: { query: "mine", sort: "title" } } });
  expect((sent as {profilePatch: object}).profilePatch).not.toHaveProperty("color");
});

test("Team editors preserve a rejected server CAS draft and bind conscious resave to the reviewed current values", async () => {
  let writes = 0;
  let data = initial;
  let expected: unknown;
  const { planning } = createPlanningState({ userId: "account", initialData: initial, initialWorkspace: "team", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data, coverage: { profiles: "complete", profileUiPreferences: "complete", notificationPreferences: "complete" } }),
    saveTeamProfile: async (_id, patch, basis) => { writes++; expected = basis; if (writes === 1) { data = { ...initial, profiles: [ceo, { ...founder, weeklyCapacity: 28 }] }; throw Object.assign(new Error("Foreign change"), { status: 409, code: "profile_revision_conflict" }); } return { id: founder.id, ...patch }; },
  } });
  const editor = planning.beginTeamProfileEdit(founder);
  await expect(editor.save({ weeklyCapacity: 35 })).resolves.toMatchObject({ ok: false, kind: "versionConflict" });
  expect(editor.view()).toMatchObject({ phase: "conflict", current: { weeklyCapacity: 28 }, canResave: true });
  await editor.resave({ weeklyCapacity: 35 });
  expect(writes).toBe(2);
  expect(expected).toMatchObject({ weekly_capacity: 28 });
});


test("a second accepted change invalidates the reviewed rebase and unavailable reads never authorize resubmission", async () => {
  let data = initial;
  let available = true;
  let writes = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: initial, initialWorkspace: "team", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => { if (!available) throw new Error("Offline"); return { data, coverage: { profiles: "complete", profileUiPreferences: "complete", notificationPreferences: "complete" } }; },
    saveTeamProfile: async (_id, patch) => { writes++; return { id: founder.id, ...patch }; },
  } });
  const editor = planning.beginTeamProfileEdit(founder);
  data = { ...initial, profiles: [ceo, { ...founder, weeklyCapacity: 28 }] };
  await planning.refreshWorkspace("team");
  available = false;
  await expect(editor.save({ weeklyCapacity: 35 })).resolves.toMatchObject({ kind: "versionConflict" });
  expect(editor.view().canResave).toBe(false);
  await expect(editor.resave({ weeklyCapacity: 35 })).resolves.toMatchObject({ kind: "versionConflict" });
  expect(writes).toBe(0);
  available = true;
  await editor.refreshConflict();
  expect(editor.view().canResave).toBe(true);
  data = { ...initial, profiles: [ceo, { ...founder, weeklyCapacity: 32 }] };
  await planning.refreshWorkspace("team");
  await expect(editor.resave({ weeklyCapacity: 35 })).resolves.toMatchObject({ kind: "versionConflict" });
  expect(writes).toBe(0);
  expect(editor.view().current?.weeklyCapacity).toBe(32);
});

test("closing an editor does not discard its pending write, while the closed handle cannot start another write", async () => {
  const pending = deferred<Partial<Profile> & { id: string }>();
  let writes = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: initial, initialWorkspace: "team", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: { ...initial, profiles: [ceo, { ...founder, weeklyCapacity: 35 }] } }),
    saveTeamProfile: async () => { writes++; return pending.promise; },
  } });
  const editor = planning.beginTeamProfileEdit(founder);
  const saving = editor.save({ weeklyCapacity: 35 });
  editor.close();
  pending.resolve({ id: founder.id, weeklyCapacity: 35 });
  await saving;
  expect(planning.team().profiles.find(profile => profile.id === founder.id)?.weeklyCapacity).toBe(35);
  await expect(editor.save({ weeklyCapacity: 40 })).resolves.toMatchObject({ kind: "sessionSuperseded" });
  expect(writes).toBe(1);
});

test("an editor from a replaced account cannot dispatch and an uncertain editor cannot use conscious resave", async () => {
  let replace!: (id: string | null) => void;
  let writes = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: initial, initialWorkspace: "team", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: initial }),
    subscribeSession: listener => { replace = listener; return () => {}; },
    saveTeamProfile: async () => { writes++; throw new Error("Lost response"); },
  } });
  const editor = planning.beginTeamProfileEdit(founder);
  await expect(editor.save({ weeklyCapacity: 35 })).resolves.toMatchObject({ kind: "unconfirmed" });
  await editor.refreshConflict();
  await expect(editor.resave({ weeklyCapacity: 35 })).resolves.toMatchObject({ kind: "unconfirmed" });
  replace("replacement");
  await expect(editor.save({ weeklyCapacity: 40 })).resolves.toMatchObject({ kind: "sessionSuperseded" });
  expect(editor.view()).toMatchObject({ phase: "ended", current: null, canResave: false });
  expect(writes).toBe(1);
});

test("profile acceptance retains the raw basis only for the same accepted fields", async () => {
  const before = { ...ceo, persistenceBasis: { focus: "Before", weekly_capacity: 20, profile_color: null } };
  const read = deferred<typeof initial>();
  let sent: unknown;
  let reads = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: { ...initial, profiles: [before, founder] }, initialWorkspace: "team", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: ++reads === 1 ? await read.promise : { ...initial, profiles: [{ ...before, focus: "Own", weeklyCapacity: 35, persistenceBasis: { focus: "Own", weekly_capacity: 35, profile_color: null } }, founder] } }),
    saveOwnProfileSettings: async patch => { sent = patch; return { profile: { ...before, focus: patch.profilePatch?.focus, persistenceBasis: { focus: patch.profilePatch?.focus || null, weekly_capacity: 20, profile_color: null } }, notificationPreferences: [] }; },
  } });
  const oldRead = planning.refreshWorkspace("team");
  await planning.saveOwnProfileSettings(ceo.id, { profilePatch: { focus: "Own" } });
  read.resolve({ ...initial, profiles: [{ ...before, weeklyCapacity: 35, persistenceBasis: { focus: "Before", weekly_capacity: 35, profile_color: null } }, founder] });
  await oldRead;
  const shown = planning.profileSettings(ceo.id).profile!;
  expect(shown.persistenceBasis).toMatchObject({ focus: "Own", weekly_capacity: 35, profile_color: null });
  const editor = planning.beginOwnProfileEdit({ profile: shown, uiPreference: null, notificationPreferences: [] });
  await editor.save({ profilePatch: { color: "#2563eb" } });
  expect(sent).toMatchObject({ expected: { profile: { profile_color: null } } });
});


test("a restored color after a business rejection is not silently sent again with the next focus edit", async () => {
  let sent: unknown;
  let writes = 0;
  const shown = { ...ceo, color: "#64748b" };
  const { planning } = createPlanningState({ userId: "account", initialData: { ...initial, profiles: [shown, founder] }, initialWorkspace: "profile", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: initial }),
    saveOwnProfileSettings: async patch => { sent = patch; if (++writes === 1) throw Object.assign(new Error("Color used"), { status: 409, code: "profile_color_conflict" }); return { profile: { ...shown, ...patch.profilePatch }, notificationPreferences: [] }; },
  } });
  const editor = planning.beginOwnProfileEdit({ profile: shown, uiPreference: null, notificationPreferences: [] });
  await expect(editor.save({ profilePatch: { focus: shown.focus, color: "#f00" } })).resolves.toMatchObject({ kind: "rejected", code: "profile_color_conflict" });
  await editor.save({ profilePatch: { focus: "Draft" } });
  expect((sent as {profilePatch: object}).profilePatch).toEqual({ focus: "Draft" });
});


test("a late followup for an earlier confirmed Team write cannot replace a newer pending operation", async () => {
  const read = deferred<typeof initial>();
  const secondWrite = deferred<Partial<Profile> & { id: string }>();
  let writes = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: initial, initialWorkspace: "team", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: await read.promise, coverage: { profiles: "complete", profileUiPreferences: "complete", notificationPreferences: "complete" } }),
    saveTeamProfile: async () => ++writes === 1 ? { id: founder.id, weeklyCapacity: 30 } : secondWrite.promise,
  } });
  const first = planning.saveTeamProfile(founder.id, { weeklyCapacity: 30 });
  await Promise.resolve();
  const second = planning.saveTeamProfile(founder.id, { weeklyCapacity: 40 });
  read.resolve({ ...initial, profiles: [ceo, { ...founder, weeklyCapacity: 30 }] });
  await first;
  expect(planning.team().saves).toMatchObject([{ phase: "saving", submitted: { weeklyCapacity: 40 } }]);
  secondWrite.reject(new Error("Lost response"));
  await second;
  expect(planning.team().saves).toMatchObject([{ phase: "unconfirmed", submitted: { weeklyCapacity: 40 } }]);
});


test("a new editor cannot replace a retained unknown operation with a local comparison conflict", async () => {
  let writes = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: initial, initialWorkspace: "team", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: initial }),
    saveTeamProfile: async () => { writes++; throw new Error("Lost response"); },
  } });
  await planning.saveTeamProfile(founder.id, { weeklyCapacity: 35 });
  const editor = planning.beginTeamProfileEdit(planning.team().profiles.find(profile => profile.id === founder.id)!);
  await expect(editor.save({ weeklyCapacity: 40 })).resolves.toMatchObject({ kind: "unconfirmed" });
  expect(planning.team().saves).toMatchObject([{ phase: "unconfirmed", submitted: { weeklyCapacity: 35 } }]);
  expect(writes).toBe(1);
});
