import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { NotificationPreference, Profile, ProfileUiPreference, Task } from "@/lib/types";

const profile = { id: "person-a", name: "Ada", focus: "Before", notificationsEnabled: true } as Profile;
const task = { id: "task-a", title: "Before", updatedAt: "r1" } as Task;
const preference = { profileId: profile.id, defaultWorkspace: "planning", defaultTaskView: "board", planningFilters: { quick: [] }, expandedInitiativeIds: [], createdAt: "before", updatedAt: "before" } as unknown as ProfileUiPreference;
const initial = { ...emptyPlanningShellState, profiles: [profile], tasks: [task], profileUiPreferences: [preference] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test("own settings appear together while pending and only the acknowledged profile and preference subset enter confirmed cache", async () => {
  const response = deferred<{ profile: Profile; uiPreference: ProfileUiPreference; notificationPreferences: [] }>();
  const { planning } = createPlanningState({ userId: "account-a", initialData: initial, initialWorkspace: "profile", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: initial }),
    saveOwnProfileSettings: () => response.promise,
  } });
  const saving = planning.saveOwnProfileSettings(profile.id, { profilePatch: { focus: "After" }, uiPreferences: { ...preference, defaultTaskView: "table" } });
  expect(planning.profileSettings(profile.id)).toMatchObject({ profile: { focus: "After" }, uiPreference: { defaultTaskView: "table" }, save: { phase: "saving" } });
  expect(planning.protectedCache()?.profiles[0].focus).toBe("Before");
  response.resolve({ profile: { ...profile, focus: "After" }, uiPreference: { ...preference, defaultTaskView: "table", updatedAt: "saved" }, notificationPreferences: [] });
  await expect(saving).resolves.toMatchObject({ ok: true });
  expect(planning.profileSettings(profile.id)).toMatchObject({ profile: { focus: "After" }, uiPreference: { updatedAt: "saved" }, save: { phase: "saved" } });
  expect(planning.protectedCache()?.profiles[0].focus).toBe("After");
});

test("rejecting own settings preserves independent confirmed task and Sprint reads and does not restore the shell snapshot", async () => {
  const response = deferred<{ profile: Profile; notificationPreferences: [] }>();
  const sprint = { id: "sprint-a", name: "Confirmed Sprint" };
  const { planning } = createPlanningState({ userId: "account-a", initialData: initial, initialWorkspace: "profile", adapter: {
    saveTask: async () => ({ task: { ...task, title: "Independent", updatedAt: "r2" } }),
    readWorkspace: async () => ({ data: { ...initial, tasks: [{ ...task, title: "Independent", updatedAt: "r2" }], sprints: [sprint] as never[] } }),
    saveOwnProfileSettings: () => response.promise,
  } });
  const saving = planning.saveOwnProfileSettings(profile.id, { profilePatch: { focus: "Rejected" } });
  await planning.saveTask(task, { title: "Independent" });
  await planning.refreshWorkspace("sprint");
  response.reject(Object.assign(new Error("Invalid"), { status: 400 }));
  await expect(saving).resolves.toMatchObject({ ok: false, kind: "rejected" });
  expect(planning.profileSettings(profile.id)).toMatchObject({ profile: { focus: "Before" }, save: { phase: "rejected", submitted: { profilePatch: { focus: "Rejected" } } } });
  expect(planning.taskDetail(task.id).task).toMatchObject({ title: "Independent", updatedAt: "r2" });
  expect(planning.protectedCache()?.sprints).toEqual([sprint]);
});

test("an old read from another area cannot replace a confirmed own profile or persisted preferences", async () => {
  const read = deferred<typeof initial>();
  const { planning } = createPlanningState({ userId: "account-a", initialData: initial, initialWorkspace: "profile", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: await read.promise }),
    saveOwnProfileSettings: async () => ({ profile: { ...profile, focus: "Confirmed" }, uiPreference: { ...preference, defaultTaskView: "table" }, notificationPreferences: [] }),
  } });
  const reading = planning.refreshWorkspace("planning");
  await planning.saveOwnProfileSettings(profile.id, { profilePatch: { focus: "Confirmed" }, uiPreferences: { ...preference, defaultTaskView: "table" } });
  read.resolve(initial);
  await reading;
  expect(planning.profileSettings(profile.id)).toMatchObject({ profile: { focus: "Confirmed" }, uiPreference: { defaultTaskView: "table" } });
  expect(planning.protectedCache()?.profiles[0].focus).toBe("Confirmed");
});

test("a lost settings response keeps submitted input and safe checking cannot infer confirmation from matching values or replay the write", async () => {
  let writes = 0;
  let reads = 0;
  const { planning } = createPlanningState({ userId: "account-a", initialData: initial, initialWorkspace: "profile", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => { reads++; return { data: { ...initial, profiles: [{ ...profile, focus: "Uncertain" }] } }; },
    saveOwnProfileSettings: async () => { writes++; throw new Error("Connection lost"); },
  } });
  await expect(planning.saveOwnProfileSettings(profile.id, { profilePatch: { focus: "Uncertain" } })).resolves.toMatchObject({ ok: false, kind: "unconfirmed" });
  await planning.checkOwnProfileSettings(profile.id);
  expect(planning.profileSettings(profile.id)).toMatchObject({ profile: { focus: "Uncertain" }, save: { phase: "unconfirmed", submitted: { profilePatch: { focus: "Uncertain" } } } });
  await expect(planning.saveOwnProfileSettings(profile.id, { profilePatch: { focus: "Unsafe retry" } })).resolves.toMatchObject({ ok: false, kind: "unconfirmed" });
  expect(writes).toBe(1);
  expect(reads).toBe(1);
});

test.each([null, "account-b"])("ended and replaced sessions withhold profile data and reject late own settings (%s)", async account => {
  const response = deferred<{ profile: Profile; notificationPreferences: [] }>();
  let replace!: (account: string | null) => void;
  const { planning } = createPlanningState({ userId: "account-a", initialData: initial, initialWorkspace: "profile", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: initial }), saveOwnProfileSettings: () => response.promise,
    subscribeSession: listener => { replace = listener; return () => {}; },
  } });
  const saving = planning.saveOwnProfileSettings(profile.id, { profilePatch: { focus: "Private" } });
  replace(account);
  response.resolve({ profile: { ...profile, focus: "Late" }, notificationPreferences: [] });
  await expect(saving).resolves.toMatchObject({ ok: false, kind: "sessionSuperseded" });
  expect(planning.profileSettings(profile.id)).toMatchObject({ profile: null, notificationPreferences: [], uiPreference: null, acknowledgements: [], save: { submitted: null } });
  expect(planning.protectedCache()).toBeNull();
});

test("persisted tour acknowledgements share confirmation, cache and session acceptance", async () => {
  const acknowledgement = { profileId: profile.id, tourId: "planning-tour", seenAt: "confirmed" };
  const response = deferred<typeof acknowledgement>();
  let replace!: (account: string | null) => void;
  const { planning } = createPlanningState({ userId: "account-a", initialData: initial, adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: initial }), acknowledgeFeatureTour: () => response.promise,
    subscribeSession: listener => { replace = listener; return () => {}; },
  } });
  const marking = planning.acknowledgeFeatureTour(profile.id, "planning-tour");
  expect(planning.profileSettings(profile.id).acknowledgements).toEqual([]);
  response.resolve(acknowledgement);
  await expect(marking).resolves.toMatchObject({ ok: true });
  expect(planning.profileSettings(profile.id).acknowledgements).toEqual([acknowledgement]);
  expect(planning.protectedCache()?.profileFeatureTourAcknowledgements).toEqual([acknowledgement]);
  replace(null);
  expect(planning.profileSettings(profile.id).acknowledgements).toEqual([]);
});

test("temporary profile read failures preserve authorized data, while denial remains withheld until an authorized read succeeds", async () => {
  let status = 503;
  const read = deferred<typeof initial>();
  let load = async (): Promise<{ data: typeof initial }> => { throw Object.assign(new Error("Unavailable"), { status }); };
  const { planning } = createPlanningState({ userId: "account-a", initialData: initial, initialWorkspace: "profile", adapter: {
    saveTask: async () => ({ task }), readWorkspace: () => load(),
  } });
  planning.profileSettings(profile.id);
  await planning.refreshWorkspace("profile");
  expect(planning.profileSettings(profile.id)).toMatchObject({ profile: { focus: "Before" }, readStatus: "unavailable" });
  status = 403;
  await planning.refreshWorkspace("profile");
  expect(planning.profileSettings(profile.id)).toMatchObject({ profile: null, uiPreference: null, readStatus: "forbidden" });
  expect(planning.protectedCache("profile")).toBeNull();
  expect(planning.protectedCache()?.profiles).toEqual([]);
  expect(planning.protectedCache()?.tasks[0].id).toBe(task.id);
  load = async () => ({ data: await read.promise });
  const loading = planning.refreshWorkspace("profile");
  expect(planning.profileSettings(profile.id).profile).toBeNull();
  read.resolve(initial);
  await loading;
  expect(planning.profileSettings(profile.id)).toMatchObject({ profile: { focus: "Before" }, readStatus: "current" });
});

test("API-token views share safe metadata while the one-time secret is returned only to its active local presentation", async () => {
  const tokenRecord = { id: "token-a", label: "Automation", revokedAt: null, expiresAt: "2099-01-01" } as never;
  const { planning } = createPlanningState({ userId: "account-a", initialData: initial, adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: initial }),
    readProfileApiTokens: async () => ({ tokens: [], canIssueEmptyEpicDeletes: false }),
    issueProfileApiToken: async () => ({ token: "one-time-secret", tokenRecord }),
  } });
  await planning.loadProfileApiTokens();
  await expect(planning.issueProfileApiToken({ label: "Automation", allowUpdates: false, allowEmptyEpicDeletes: false, allowGitHubSync: false })).resolves.toEqual({ ok: true, token: "one-time-secret" });
  expect(planning.profileApiTokens()).toMatchObject({ tokens: [tokenRecord], readStatus: "current" });
  expect(JSON.stringify(planning.profileApiTokens())).not.toContain("one-time-secret");
  expect(JSON.stringify(planning.protectedCache())).not.toContain("one-time-secret");
});

test("an uncertain token issuance is checked by a read and never retried to recover a lost secret", async () => {
  let writes = 0;
  let reads = 0;
  const draft = { label: "Automation", allowUpdates: false, allowEmptyEpicDeletes: false, allowGitHubSync: false };
  const { planning } = createPlanningState({ userId: "account-a", initialData: initial, adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: initial }),
    readProfileApiTokens: async () => { reads++; return { tokens: [{ id: "possible-token", label: "Automation", expiresAt: "2099-01-01" } as never], canIssueEmptyEpicDeletes: false }; },
    issueProfileApiToken: async () => { writes++; throw new Error("Connection lost"); },
  } });
  await expect(planning.issueProfileApiToken(draft)).resolves.toMatchObject({ ok: false, kind: "unconfirmed" });
  await planning.loadProfileApiTokens();
  await expect(planning.issueProfileApiToken(draft)).resolves.toMatchObject({ ok: false, kind: "unconfirmed" });
  expect(planning.profileApiTokens()).toMatchObject({ tokens: [{ id: "possible-token" }], operations: [{ phase: "unconfirmed", submitted: draft }] });
  expect(writes).toBe(1);
  expect(reads).toBeGreaterThanOrEqual(1);
});

test("logout prevents late token metadata and the one-time secret from reaching a presentation", async () => {
  const response = deferred<{ token: string; tokenRecord: never }>();
  let replace!: (account: string | null) => void;
  const { planning } = createPlanningState({ userId: "account-a", initialData: initial, adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: initial }), issueProfileApiToken: () => response.promise,
    subscribeSession: listener => { replace = listener; return () => {}; },
  } });
  const issuing = planning.issueProfileApiToken({ label: "Automation", allowUpdates: false, allowEmptyEpicDeletes: false, allowGitHubSync: false });
  replace(null);
  response.resolve({ token: "late-secret", tokenRecord: { id: "late" } as never });
  await expect(issuing).resolves.toMatchObject({ ok: false, kind: "sessionSuperseded" });
  expect(planning.profileApiTokens()).toEqual({ tokens: [], canIssueEmptyEpicDeletes: false, readStatus: "not-loaded", operations: [] });
});

test("an older token-list response cannot reinsert a token after its confirmed revocation", async () => {
  const read = deferred<{ tokens: never[]; canIssueEmptyEpicDeletes: boolean }>();
  const { planning } = createPlanningState({ userId: "account-a", initialData: initial, adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: initial }),
    readProfileApiTokens: () => read.promise, revokeProfileApiToken: async () => {},
  } });
  const reading = planning.loadProfileApiTokens();
  await planning.revokeProfileApiToken("token-a");
  read.resolve({ tokens: [{ id: "token-a" } as never], canIssueEmptyEpicDeletes: false });
  await reading;
  expect(planning.profileApiTokens()).toMatchObject({ tokens: [], readStatus: "stale", operations: [{ action: "revoke", tokenId: "token-a", phase: "saved" }] });
});

test("confirming a tour does not freeze an independent profile read that was already in flight", async () => {
  const read = deferred<typeof initial>();
  const { planning } = createPlanningState({ userId: "account-a", initialData: initial, initialWorkspace: "profile", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: await read.promise }),
    acknowledgeFeatureTour: async tourId => ({ profileId: profile.id, tourId, seenAt: "confirmed" }),
  } });
  const reading = planning.refreshWorkspace("profile");
  await planning.acknowledgeFeatureTour(profile.id, "tour");
  read.resolve({ ...initial, profiles: [{ ...profile, focus: "Other accepted change" }] });
  await reading;
  expect(planning.profileSettings(profile.id)).toMatchObject({ profile: { focus: "Other accepted change" }, acknowledgements: [{ tourId: "tour" }] });
});

test("a discarded settings response remains distinct from a color collision and retains the submitted input", async () => {
  const { planning } = createPlanningState({ userId: "account-a", initialData: initial, initialWorkspace: "profile", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: initial }),
    saveOwnProfileSettings: async () => { throw Object.assign(new Error("Replaced"), { status: 409, code: "session_superseded" }); },
  } });
  await expect(planning.saveOwnProfileSettings(profile.id, { profilePatch: { focus: "Uncertain" } })).resolves.toMatchObject({ ok: false, kind: "sessionSuperseded", code: "session_superseded" });
  expect(planning.profileSettings(profile.id)).toMatchObject({ profile: { focus: "Uncertain" }, save: { phase: "unconfirmed", submitted: { profilePatch: { focus: "Uncertain" } } } });
});

test("a settings acknowledgement upserts only its returned notification subset and preserves other events and profiles", async () => {
  const existing: NotificationPreference[] = [
    { id: 1, profileId: profile.id, channel: "google_chat", eventType: "task.created", enabled: true },
    { id: 2, profileId: profile.id, channel: "google_chat", eventType: "task.updated", enabled: true },
    { id: 3, profileId: "person-b", channel: "google_chat", eventType: "task.created", enabled: true },
  ];
  const { planning } = createPlanningState({ userId: "account-a", initialData: { ...initial, notificationPreferences: existing }, initialWorkspace: "profile", adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: initial }),
    saveOwnProfileSettings: async () => ({ profile: { ...profile, notificationsEnabled: false }, notificationPreferences: [{ ...existing[0], enabled: false }] }),
  } });
  await planning.saveOwnProfileSettings(profile.id, { profilePatch: { notificationsEnabled: false }, notificationEvents: { "task.created": false } });
  expect(planning.profileSettings(profile.id)).toMatchObject({ profile: { notificationsEnabled: false }, notificationPreferences: [{ id: 1, enabled: false }, { id: 2, enabled: true }] });
  expect(planning.protectedCache()?.notificationPreferences).toEqual([{ ...existing[0], enabled: false }, existing[1], existing[2]]);
});

test("the bounded confirmed cache withholds explicitly denied task identities while independent profile data remains usable", async () => {
  const { planning } = createPlanningState({ userId: "account-a", initialData: initial, adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: initial }),
    readTaskDetail: async () => { throw Object.assign(new Error("Denied"), { status: 403 }); },
  } });
  await planning.loadTaskDetail(task.id);
  expect(planning.protectedCache()?.tasks).toEqual([]);
  expect(planning.protectedCache()?.profiles[0].id).toBe(profile.id);
});

test("a token-display denial while issuance is pending withholds its late one-time secret even if access is later restored", async () => {
  const response = deferred<{ token: string; tokenRecord: never }>();
  let denied = true;
  const { planning } = createPlanningState({ userId: "account-a", initialData: initial, adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ({ data: initial }),
    issueProfileApiToken: () => response.promise,
    readProfileApiTokens: async () => { if (denied) throw Object.assign(new Error("Denied"), { status: 403 }); return { tokens: [], canIssueEmptyEpicDeletes: false }; },
  } });
  const issuing = planning.issueProfileApiToken({ label: "Automation", allowUpdates: false, allowEmptyEpicDeletes: false, allowGitHubSync: false });
  await planning.loadProfileApiTokens();
  response.resolve({ token: "withheld-secret", tokenRecord: { id: "token-a" } as never });
  const result = await issuing;
  expect(result).toMatchObject({ ok: false, status: 403 });
  expect(result).not.toHaveProperty("token");
  denied = false;
  await planning.loadProfileApiTokens();
  expect(JSON.stringify(planning.profileApiTokens())).not.toContain("withheld-secret");
});
