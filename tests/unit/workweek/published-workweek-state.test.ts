import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyTeamWorkweekWindows } from "@/features/team-workweek/model/team-workweek-draft";
import type { CalendarTeamWorkweek } from "@/features/team-workweek/model/team-workweek-calendar";

const week = { policy: "team-week" as const, from: "2026-10-05", to: "2026-10-11" };
const month = { policy: "header-month" as const, from: "2026-09-28", to: "2026-11-08" };
const row: CalendarTeamWorkweek = { id: "publication", ownerProfileId: "founder", effectiveFrom: "2026-10-01", effectiveTo: null, timezone: "Europe/Berlin", publicationRevision: 1, lastSyncAt: "2026-10-01T07:00:00Z", windows: { ...emptyTeamWorkweekWindows(), monday: [{ start: "09:00", end: "17:00" }] } };

test("Team week and Header month share accepted publication identities while a complete empty range clears only its covered dates", async () => {
  let calendarWorkweeks = [row];
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readWorkweekCalendar: async () => ({ currentWorkweeks: calendarWorkweeks, calendarWorkweeks, referenceDate: "2026-10-05" }),
  } });
  expect(planning.workweekCalendar(week)).toMatchObject({ readStatus: "not-loaded", coverage: "none", snapshot: null });
  await planning.loadWorkweekCalendar(month);
  await planning.loadWorkweekCalendar(week);
  calendarWorkweeks = [{ ...row, publicationRevision: 2, windows: { ...row.windows, monday: [{ start: "11:00", end: "17:00" }] } }];
  await planning.loadWorkweekCalendar(week);
  expect(planning.workweekCalendar(month).snapshot?.calendarWorkweeks[0].windows.monday).toEqual([{ start: "11:00", end: "17:00" }]);
  calendarWorkweeks = [];
  await planning.loadWorkweekCalendar(week);
  expect(planning.workweekCalendar(week)).toMatchObject({ readStatus: "current", coverage: "complete", snapshot: { calendarWorkweeks: [] } });
  expect(planning.workweekCalendar(month).snapshot?.calendarWorkweeks).toHaveLength(1);
  expect(planning.workweekCalendar(month).snapshot?.calendarByDay["2026-10-05"]).toEqual([]);
  expect(planning.workweekCalendar(month).snapshot?.calendarByDay["2026-10-12"]).toHaveLength(1);
});

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test("an older overlapping complete read cannot erase a newer week or replace its publication binding", async () => {
  const old = deferred<import("@/features/team-workweek/model/published-workweek-calendar-state").WorkweekCalendarResponse>();
  const newer = { ...row, publicationRevision: 2, windows: { ...row.windows, monday: [{ start: "11:00", end: "17:00" }] } };
  let reads = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readWorkweekCalendar: async () => ++reads === 1 ? old.promise : { currentWorkweeks: [newer], calendarWorkweeks: [newer], referenceDate: "2026-10-05", publishedOwnerIds: ["founder"] },
  } });
  const first = planning.loadWorkweekCalendar(month);
  await planning.loadWorkweekCalendar(week);
  old.resolve({ currentWorkweeks: [], calendarWorkweeks: [], referenceDate: "2026-10-05", publishedOwnerIds: [] });
  await first;
  expect(planning.workweekCalendar(month)).toMatchObject({ readStatus: "stale", snapshot: { publishedOwnerIds: ["founder"] } });
  expect(planning.workweekCalendar(month).snapshot?.calendarByDay["2026-10-05"]).toMatchObject([{ id: row.id, publicationRevision: 2 }]);
  expect(planning.workweekCalendar(week).snapshot?.calendarWorkweeks).toMatchObject([{ publicationRevision: 2, windows: { monday: [{ start: "11:00" }] } }]);
});

test("a partial range cannot clear accepted dates and publication revisions compare only inside their identity binding", async () => {
  let response = { currentWorkweeks: [row], calendarWorkweeks: [row], referenceDate: "2026-10-05", calendarCoverage: "complete" as "complete" | "partial" };
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readWorkweekCalendar: async () => response } });
  await planning.loadWorkweekCalendar(month);
  response = { ...response, currentWorkweeks: [], calendarWorkweeks: [], calendarCoverage: "partial" };
  await planning.loadWorkweekCalendar(week);
  expect(planning.workweekCalendar(week)).toMatchObject({ coverage: "partial", readStatus: "stale" });
  expect(planning.workweekCalendar(week).snapshot?.calendarByDay["2026-10-05"]).toHaveLength(1);
  expect(planning.workweekCalendar(month).snapshot?.calendarByDay["2026-10-05"]).toHaveLength(1);
  response = { ...response, currentWorkweeks: [{ ...row, publicationRevision: 3 }], calendarWorkweeks: [{ ...row, publicationRevision: 3 }], calendarCoverage: "complete" };
  await planning.loadWorkweekCalendar(week);
  response = { ...response, currentWorkweeks: [row], calendarWorkweeks: [row] };
  await planning.loadWorkweekCalendar(month);
  expect(planning.workweekCalendar(month).snapshot?.calendarWorkweeks[0].publicationRevision).toBe(3);
});

test("a failed refresh retains only authorized confirmed hours while a denied read withholds all calendar ranges and old requests", async () => {
  let mode: "ok" | "offline" | "denied" | "old" = "ok";
  const old = deferred<import("@/features/team-workweek/model/published-workweek-calendar-state").WorkweekCalendarResponse>();
  const response = { currentWorkweeks: [row], calendarWorkweeks: [row], referenceDate: "2026-10-05" };
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readWorkweekCalendar: async () => {
    if (mode === "old") return old.promise;
    if (mode !== "ok") throw Object.assign(new Error(mode), { status: mode === "denied" ? 403 : 503 });
    return response;
  } } });
  await planning.loadWorkweekCalendar(month);
  mode = "offline";
  await planning.loadWorkweekCalendar(month);
  expect(planning.workweekCalendar(month)).toMatchObject({ readStatus: "unavailable", snapshot: { calendarWorkweeks: [{ id: row.id }] } });
  mode = "old";
  const pending = planning.loadWorkweekCalendar(month);
  mode = "denied";
  await planning.loadWorkweekCalendar(week);
  expect(planning.workweekCalendar(month)).toMatchObject({ readStatus: "forbidden", snapshot: null });
  old.resolve(response);
  await pending;
  expect(planning.workweekCalendar(month).snapshot).toBeNull();
  mode = "offline";
  await planning.loadWorkweekCalendar(month);
  expect(planning.workweekCalendar(month)).toMatchObject({ readStatus: "forbidden", snapshot: null });
  mode = "ok";
  await planning.loadWorkweekCalendar(week);
  expect(planning.workweekCalendar(week).snapshot).not.toBeNull();
  expect(planning.workweekCalendar(month).snapshot).toBeNull();
});


test("range reads coalesce and normal publication invalidation discards old reads without replaying a write", async () => {
  const first = deferred<import("@/features/team-workweek/model/published-workweek-calendar-state").WorkweekCalendarResponse>();
  let reads = 0;
  const { planning, internal } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readWorkweekCalendar: async () => ++reads === 1 ? first.promise : { currentWorkweeks: [], calendarWorkweeks: [], referenceDate: "2026-10-05" } } });
  const older = planning.loadWorkweekCalendar(week);
  const same = planning.loadWorkweekCalendar(week);
  expect(reads).toBe(1);
  internal.invalidatePublishedWorkweeks();
  await planning.loadWorkweekCalendar(week);
  expect(reads).toBe(2);
  first.resolve({ currentWorkweeks: [row], calendarWorkweeks: [row], referenceDate: "2026-10-05" });
  await older; await same;
  expect(planning.workweekCalendar(week)).toMatchObject({ coverage: "complete", snapshot: { calendarWorkweeks: [] } });
});

test.each([null, "replacement"])("calendar rows, pending reads and all cached ranges end with the session (%s)", async replacement => {
  const pending = deferred<import("@/features/team-workweek/model/published-workweek-calendar-state").WorkweekCalendarResponse>();
  let replace!: (user: string | null) => void;
  let reads = 0;
  const response = { currentWorkweeks: [row], calendarWorkweeks: [row], referenceDate: "2026-10-05" };
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, subscribeSession: listener => { replace = listener; return () => {}; }, readWorkweekCalendar: async () => ++reads === 1 ? response : pending.promise } });
  await planning.loadWorkweekCalendar(month);
  const reading = planning.loadWorkweekCalendar(week);
  replace(replacement);
  expect(planning.workweekCalendar(month)).toMatchObject({ readStatus: "not-loaded", snapshot: null });
  pending.resolve(response);
  await reading;
  expect(planning.workweekCalendar(week)).toMatchObject({ readStatus: "not-loaded", snapshot: null });
});

test("authority invalidation withholds published rows during unavailable rechecks and cannot accept earlier answers", async () => {
  let offline = false;
  const response = { currentWorkweeks: [row], calendarWorkweeks: [row], referenceDate: "2026-10-05" };
  const { planning, internal } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readWorkweekCalendar: async () => { if (offline) throw new Error("Offline"); return response; } } });
  await planning.loadWorkweekCalendar(month);
  internal.invalidateWorkweekCalendarAuthority();
  expect(planning.workweekCalendar(month)).toMatchObject({ readStatus: "forbidden", snapshot: null });
  offline = true;
  await planning.loadWorkweekCalendar(month);
  expect(planning.workweekCalendar(month)).toMatchObject({ readStatus: "forbidden", snapshot: null });
  offline = false;
  await planning.loadWorkweekCalendar(month);
  expect(planning.workweekCalendar(month)).toMatchObject({ readStatus: "current", snapshot: { calendarWorkweeks: [{ id: row.id }] } });
});

test("the eight-entry week cache does not evict month coverage, and freshness expires after sixty seconds, Berlin midnight or activation", async () => {
  let now = Date.parse("2026-10-05T10:00:00Z");
  const timing: { activation?: string } = {};
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: { now: () => now, saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readWorkweekCalendar: async () => ({ currentWorkweeks: [row], calendarWorkweeks: [row], referenceDate: "2026-10-05", workweeks: timing.activation ? [{ effectiveAt: timing.activation }] : [] }) } });
  await planning.loadWorkweekCalendar(month);
  await planning.loadWorkweekCalendar(week);
  now += 59_999;
  expect(planning.workweekCalendar(week).cacheFresh).toBe(true);
  now += 1;
  expect(planning.workweekCalendar(week)).toMatchObject({ cacheFresh: false, readStatus: "stale" });
  now = Date.parse("2026-10-05T21:59:45Z");
  await planning.loadWorkweekCalendar(week);
  now += 15_000;
  expect(planning.workweekCalendar(week).cacheFresh).toBe(false);
  timing.activation = new Date(now + 10_000).toISOString();
  await planning.loadWorkweekCalendar(week);
  now += 10_000;
  expect(planning.workweekCalendar(week).cacheFresh).toBe(false);
  for (const from of ["2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30"]) await planning.loadWorkweekCalendar({ ...week, from, to: from });
  expect(planning.workweekCalendar(week)).toMatchObject({ readStatus: "not-loaded", coverage: "none", snapshot: null });
  expect(planning.workweekCalendar(month).snapshot?.calendarWorkweeks).toHaveLength(1);
});
