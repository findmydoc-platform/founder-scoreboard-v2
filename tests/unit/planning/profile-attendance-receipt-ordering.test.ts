import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { Meeting, MeetingAttendance, PlanningShellState, Profile } from "@/lib/types";
import { defaultFilters } from "@/features/profile/model/profile-settings-view-model";
import type { OwnProfileSettingsConfirmation } from "@/features/profile/model/profile-settings-contract";
const profile = { id: "person", name: "Ada", focus: "Before", color: "#111111", notificationsEnabled: true } as Profile;
const other = { ...profile, id: "other", focus: "Independent" };
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>(yes => { resolve = yes; });
    return { promise, resolve };
}
test("a later accepted foreign profile read survives a held own receipt in the view and confirmed cache", async () => {
    const response = deferred<OwnProfileSettingsConfirmation>();
    const cache: {
        current: PlanningShellState | null;
    } = { current: null };
    const { planning } = createPlanningState({ userId: "account", initialWorkspace: "profile", initialData: { ...emptyPlanningShellState, profiles: [profile, other] }, publishCache: data => { cache.current = data; }, adapter: {
            saveTask: async () => ({ task: {} }),
            saveOwnProfileSettings: () => response.promise,
            readWorkspace: async () => ({ data: { ...emptyPlanningShellState, profiles: [{ ...profile, focus: "Foreign current", color: "#222222" }, other] }, coverage: { profiles: "complete" } }),
        } });
    const saving = planning.saveOwnProfileSettings(profile.id, { profilePatch: { focus: "Mine" } });
    await planning.refreshWorkspace("profile");
    response.resolve({ profile: { ...profile, focus: "Mine" }, notificationPreferences: [] });
    expect(await saving).toMatchObject({ ok: true });
    expect(planning.profileSettings(profile.id)).toMatchObject({ profile: { focus: "Foreign current", color: "#222222" }, save: { phase: "saved" } });
    expect(cache.current?.profiles).toEqual(expect.arrayContaining([expect.objectContaining({ id: profile.id, focus: "Foreign current" }), other]));
});
for (const order of ["read-first", "receipt-first"] as const)
    for (const readValue of ["baseline", "foreign"] as const)
        test(`own profile ${order}/${readValue}: actual receipt and newer accepted fields remain distinct`, async () => {
            const response = deferred<OwnProfileSettingsConfirmation>(), readReady = deferred<void>();
            const cache: {
                current: PlanningShellState | null;
            } = { current: null };
            let reads = 0, writes = 0;
            const ui = { profileId: profile.id, defaultWorkspace: "planning", defaultTaskView: "board", planningFilters: defaultFilters(), expandedInitiativeIds: [], createdAt: "before", updatedAt: "before" } as import("@/lib/types").ProfileUiPreference;
            const event = { id: 1, profileId: profile.id, channel: "google_chat", eventType: "task_assigned", enabled: true } as import("@/lib/types").NotificationPreference;
            const initial = { ...emptyPlanningShellState, profiles: [profile, other], profileUiPreferences: [ui], notificationPreferences: [event] };
            const foreign = { ...initial, profiles: [{ ...profile, focus: "Foreign", color: "#222222" }, other], profileUiPreferences: [{ ...ui, defaultWorkspace: "team" as const, updatedAt: "foreign" }], notificationPreferences: [{ ...event, enabled: false }] };
            const { planning } = createPlanningState({ userId: "account", initialWorkspace: "profile", initialData: initial, publishCache: data => { cache.current = data; }, adapter: {
                    saveTask: async () => ({ task: {} }), saveOwnProfileSettings: () => { writes++; return response.promise; }, readWorkspace: async () => { reads++; await readReady.promise; return { data: readValue === "foreign" ? foreign : initial, coverage: { profiles: "complete", profileUiPreferences: "complete", notificationPreferences: "complete" } }; },
                } });
            const saving = planning.saveOwnProfileSettings(profile.id, { profilePatch: { focus: "Mine" }, uiPreferences: { ...ui, defaultTaskView: "table" }, notificationEvents: { task_assigned: false } });
            const reading = planning.refreshWorkspace("profile");
            if (order === "read-first") {
                readReady.resolve();
                await reading;
            }
            response.resolve({ profile: { ...profile, focus: "Mine" }, uiPreference: { ...ui, defaultTaskView: "table", updatedAt: "own" }, notificationPreferences: [{ ...event, enabled: false }] });
            expect(await saving).toMatchObject({ ok: true });
            if (order === "receipt-first") {
                readReady.resolve();
                await reading;
            }
            expect(planning.profileSettings(profile.id)).toMatchObject({ profile: { focus: readValue === "foreign" ? "Foreign" : "Mine", color: readValue === "foreign" ? "#222222" : "#111111" }, uiPreference: { defaultWorkspace: readValue === "foreign" ? "team" : "planning", defaultTaskView: readValue === "foreign" ? "board" : "table" }, notificationPreferences: [{ enabled: false }], save: { phase: "saved" } });
            expect(cache.current?.profiles.find(row => row.id === profile.id)?.focus).toBe(readValue === "foreign" ? "Foreign" : "Mine");
            expect(cache.current?.profileUiPreferences[0].defaultTaskView).toBe(readValue === "foreign" ? "board" : "table");
            expect(planning.profileSettings(other.id).profile?.focus).toBe("Independent");
            expect({ reads, writes }).toEqual({ reads: 1, writes: 1 });
        });
test("a confirmed own editor never adopts a foreign field as its next editing basis", async () => {
    const response = deferred<OwnProfileSettingsConfirmation>();
    let writes = 0;
    const { planning } = createPlanningState({ userId: "account", initialWorkspace: "profile", initialData: { ...emptyPlanningShellState, profiles: [profile] }, adapter: {
            saveTask: async () => ({ task: {} }), saveOwnProfileSettings: () => { writes++; return response.promise; }, readWorkspace: async () => ({ data: { ...emptyPlanningShellState, profiles: [{ ...profile, focus: "Foreign" }] }, coverage: { profiles: "complete" } }),
        } });
    const editor = planning.beginOwnProfileEdit({ profile, uiPreference: null, notificationPreferences: [] });
    const saving = editor.save({ profilePatch: { focus: "Mine" } });
    await planning.refreshWorkspace("profile");
    response.resolve({ profile: { ...profile, focus: "Mine" }, notificationPreferences: [] });
    expect(await saving).toMatchObject({ ok: true });
    expect(await editor.save({ profilePatch: { focus: "Another deliberate edit" } })).toMatchObject({ kind: "versionConflict" });
    expect(writes).toBe(1);
});
const meeting: Meeting = { id: 7, sprintId: "sprint", title: "Weekly", meetingAt: "2026-10-28T09:00:00Z", status: "planned", agenda: "" };
const attendance: MeetingAttendance = { id: 8, meetingId: 7, profileId: "person", status: "pending", absenceReason: "", writtenUpdate: "", reasonAccepted: false, points: 0, createdAt: "created", updatedAt: "baseline" };
for (const path of ["pair", "workspace"] as const)
    for (const order of ["read-first", "receipt-first"] as const)
        for (const value of ["baseline", "foreign"] as const)
            test(`attendance ${path}/${order}/${value}: accepted row and points survive actual response ordering`, async () => {
                const response = deferred<import("@/features/sprint/model/meeting-attendance-state").MeetingAttendanceReceipt>(), readReady = deferred<void>();
                const otherAttendance = { ...attendance, id: 9, profileId: "other" };
                const current = value === "foreign" ? { ...attendance, writtenUpdate: "Foreign", points: 5, updatedAt: "foreign" } : attendance;
                const cache: {
                    current: PlanningShellState | null;
                } = { current: null };
                let reads = 0, writes = 0;
                const { planning } = createPlanningState({ userId: "account", initialWorkspace: "sprint", initialData: { ...emptyPlanningShellState, meetings: [meeting], meetingAttendance: [attendance, otherAttendance] }, publishCache: data => { cache.current = data; }, adapter: {
                        saveTask: async () => ({ task: {} }),
                        saveMeetingAttendance: async (_, basis, input) => { writes++; return input.profileId === "person" ? response.promise : { attendance: { ...input, id: 9, points: 3, updatedAt: "independent" }, effects: "confirmed" }; },
                        readMeetingAttendance: async () => { reads++; await readReady.promise; return { attendance: current }; },
                        readWorkspace: async () => { reads++; await readReady.promise; return { data: { ...emptyPlanningShellState, meetingAttendance: [current, otherAttendance] }, coverage: { meetingAttendance: "complete" } }; },
                    } });
                const editor = planning.beginMeetingAttendance(meeting, attendance.profileId, attendance), saving = editor.save({ writtenUpdate: "Mine", points: 2 });
                const reading = path === "pair" ? editor.checkOutcome() : planning.refreshWorkspace("sprint");
                if (order === "read-first") {
                    readReady.resolve();
                    await reading;
                }
                expect(await planning.beginMeetingAttendance(meeting, "other", otherAttendance).save({ writtenUpdate: "Independent" })).toMatchObject({ ok: true });
                response.resolve({ attendance: { ...attendance, writtenUpdate: "Mine", points: 2, updatedAt: "own" }, effects: "confirmed" });
                expect(await saving).toMatchObject({ ok: true });
                if (order === "receipt-first") {
                    readReady.resolve();
                    await reading;
                }
                const expected = { updatedAt: value === "foreign" ? "foreign" : "own", points: value === "foreign" ? 5 : 2 };
                expect(planning.meetingAttendance(7, "person").record).toMatchObject(expected);
                expect(planning.sprintWorkspace().model.attendance).toEqual(expect.arrayContaining([expect.objectContaining(expected), expect.objectContaining({ profileId: "other", updatedAt: "independent", points: 3 })]));
                expect(cache.current?.meetingAttendance).toEqual(expect.arrayContaining([expect.objectContaining(expected), expect.objectContaining({ profileId: "other", updatedAt: "independent" })]));
                expect(editor.view().phase).toBe("confirmed");
                expect({ reads, writes }).toEqual({ reads: 1, writes: 2 });
            });
test("an attendance editor keeps its own confirmed basis after a newer foreign read", async () => {
    const response = deferred<import("@/features/sprint/model/meeting-attendance-state").MeetingAttendanceReceipt>();
    const sent: (string | undefined)[] = [];
    const { planning } = createPlanningState({ userId: "account", initialData: { ...emptyPlanningShellState, meetings: [meeting], meetingAttendance: [attendance] }, adapter: {
            saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
            readMeetingAttendance: async () => ({ attendance: { ...attendance, updatedAt: "foreign", points: 5 } }),
            saveMeetingAttendance: async (_, basis) => { sent.push(basis?.updatedAt); if (sent.length > 1)
                throw Object.assign(new Error("Conflict"), { status: 409, code: "attendance_revision_conflict" }); return response.promise; },
        } });
    const editor = planning.beginMeetingAttendance(meeting, "person", attendance), saving = editor.save({ points: 2 });
    await editor.checkOutcome();
    response.resolve({ attendance: { ...attendance, updatedAt: "own", points: 2 }, effects: "confirmed" });
    await saving;
    expect(await editor.save({ points: 4 })).toMatchObject({ kind: "conflict" });
    expect(sent).toEqual(["baseline", "own"]);
    expect(planning.meetingAttendance(7, "person").record).toMatchObject({ updatedAt: "foreign", points: 5 });
});

test("an own profile receipt does not erase the ordering of an already accepted newer read", async () => {
  const response = deferred<OwnProfileSettingsConfirmation>(), older = deferred<void>();
  const { planning } = createPlanningState({ userId: "account", initialWorkspace: "profile", initialData: { ...emptyPlanningShellState, profiles: [profile] }, adapter: {
    saveTask: async () => ({ task: {} }), saveOwnProfileSettings: () => response.promise,
    readWorkspace: async workspace => { if (workspace === "team") await older.promise; return { data: { ...emptyPlanningShellState, profiles: [{ ...profile, focus: workspace === "team" ? "Older foreign" : "Mine" }] }, coverage: { profiles: "complete" } }; },
  } });
  const saving = planning.saveOwnProfileSettings(profile.id, { profilePatch: { focus: "Mine" } });
  const oldRead = planning.refreshWorkspace("team"); await planning.refreshWorkspace("profile");
  response.resolve({ profile: { ...profile, focus: "Mine" }, notificationPreferences: [] }); await saving;
  older.resolve(); await oldRead;
  expect(planning.profileSettings(profile.id).profile?.focus).toBe("Mine");
  expect(planning.protectedCache()?.profiles[0].focus).toBe("Mine");
});

test("an own Attendance receipt does not erase a newer accepted pair observation", async () => {
  const response = deferred<import("@/features/sprint/model/meeting-attendance-state").MeetingAttendanceReceipt>(), older = deferred<void>();
  const own = { ...attendance, points: 2, updatedAt: "own" };
  const { planning } = createPlanningState({ userId: "account", initialData: { ...emptyPlanningShellState, meetings: [meeting], meetingAttendance: [attendance] }, adapter: {
    saveTask: async () => ({ task: {} }), saveMeetingAttendance: () => response.promise,
    readMeetingAttendance: async () => { await older.promise; return { attendance: { ...attendance, points: 1, updatedAt: "older-foreign" } }; },
    readWorkspace: async () => ({ data: { ...emptyPlanningShellState, meetingAttendance: [own] }, coverage: { meetingAttendance: "complete" } }),
  } });
  const editor = planning.beginMeetingAttendance(meeting, "person", attendance), saving = editor.save({ points: 2 });
  const oldRead = editor.checkOutcome(); await planning.refreshWorkspace("sprint");
  response.resolve({ attendance: own, effects: "confirmed" }); await saving;
  older.resolve(); await oldRead;
  expect(planning.meetingAttendance(7, "person").record).toMatchObject({ updatedAt: "own", points: 2 });
  expect(planning.sprintWorkspace().model.attendance).toContainEqual(own);
});
