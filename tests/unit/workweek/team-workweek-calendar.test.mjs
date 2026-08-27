import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const draft = await import("../../../src/features/team-workweek/model/team-workweek-draft.ts");
const model = await importTestModule(
  "src/features/team-workweek/model/team-workweek-calendar.ts",
  { "./team-workweek-draft": draft },
);

function windows(patch = {}) {
  return { ...draft.emptyTeamWorkweekWindows(), ...patch };
}

const profiles = [
  { id: "one", name: "One", platformRole: "ceo" },
  { id: "two", name: "Two", platformRole: "founder" },
];

function publication(id, ownerProfileId, effectiveFrom, effectiveTo, publicationRevision, dayWindows) {
  return {
    id,
    ownerProfileId,
    effectiveFrom,
    effectiveTo,
    timezone: "Europe/Berlin",
    publicationRevision,
    lastSyncAt: "2026-08-25T10:00:00.000Z",
    windows: dayWindows,
  };
}

test("calendar ranges are strict ISO dates, inclusive, and limited to 42 days", () => {
  assert.deepEqual(model.validateCalendarWorkweekRange(null, null), { ok: true, range: null });
  assert.equal(model.validateCalendarWorkweekRange("2026-08-24", null).ok, false);
  assert.equal(model.validateCalendarWorkweekRange("2026-02-30", "2026-03-01").ok, false);
  assert.equal(model.validateCalendarWorkweekRange("2026-08-25", "2026-08-24").ok, false);
  assert.deepEqual(model.validateCalendarWorkweekRange("2026-08-24", "2026-10-04"), {
    ok: true,
    range: { from: "2026-08-24", to: "2026-10-04" },
  });
  assert.equal(model.validateCalendarWorkweekRange("2026-08-24", "2026-10-05").ok, false);
  assert.deepEqual(model.calendarGridRange("2026-08-01"), { from: "2026-07-27", to: "2026-09-06" });
});

test("date and clock projection stay explicit to Europe/Berlin across DST", () => {
  assert.equal(model.berlinDateKey(new Date("2026-03-29T22:30:00.000Z")), "2026-03-30");
  assert.equal(model.berlinClockMinute(new Date("2026-08-24T07:00:00.000Z")), 9 * 60);
  assert.equal(model.berlinClockMinute(new Date("2026-12-07T08:00:00.000Z")), 9 * 60);
});

test("Monday version changes select historical and future published versions by validity", () => {
  const history = publication("history", "one", "2026-08-17", "2026-08-30", 1, windows());
  const current = publication("current", "one", "2026-08-31", "2026-09-06", 2, windows());
  const prepared = publication("prepared", "one", "2026-09-07", null, 3, windows());
  assert.equal(model.selectCalendarWorkweek([history, current, prepared], "one", "2026-08-30")?.id, "history");
  assert.equal(model.selectCalendarWorkweek([history, current, prepared], "one", "2026-08-31")?.id, "current");
  assert.equal(model.selectCalendarWorkweek([history, current, prepared], "one", "2026-09-07")?.id, "prepared");
});

test("split windows count a person once and Jetzt uses inclusive start and exclusive end", () => {
  const calendarWorkweeks = [
    publication("one-current", "one", "2026-08-24", null, 1, windows({
      monday: [{ start: "09:00", end: "12:00" }, { start: "14:00", end: "17:00" }],
    })),
    publication("two-current", "two", "2026-08-24", null, 1, windows({
      monday: [{ start: "10:00", end: "13:00" }],
    })),
  ];

  const atStart = model.projectCalendarWorktimes({
    calendarWorkweeks,
    dateKey: "2026-08-24",
    now: new Date("2026-08-24T07:00:00.000Z"),
    profiles,
  });
  assert.equal(atStart.length, 2);
  assert.equal(atStart[0].workingNow, true);
  assert.equal(atStart[0].windows.length, 2);

  const atEnd = model.projectCalendarWorktimes({
    calendarWorkweeks,
    dateKey: "2026-08-24",
    now: new Date("2026-08-24T10:00:00.000Z"),
    profiles,
  });
  assert.equal(atEnd[0].workingNow, false);
  assert.equal(atEnd[1].workingNow, true);

  const otherDate = model.projectCalendarWorktimes({
    calendarWorkweeks,
    dateKey: "2026-08-31",
    now: new Date("2026-08-24T07:00:00.000Z"),
    profiles,
  });
  assert.equal(otherDate.every((entry) => !entry.workingNow), true);
});

test("FounderOps events are assigned to Europe/Berlin calendar dates", () => {
  const event = {
    id: 1,
    title: "Late founder event",
    category: "company",
    startsAt: "2026-08-24T22:30:00.000Z",
    endsAt: "2026-08-24T23:00:00.000Z",
    location: "",
    status: "planned",
  };
  assert.deepEqual(model.eventCalendarDayKeys(event), ["2026-08-25"]);
  assert.equal(model.eventsByCalendarDay([event]).get("2026-08-25")?.[0].id, 1);
  assert.deepEqual(model.eventCalendarDayKeys({
    ...event,
    startsAt: "2026-08-25T20:00:00.000Z",
    endsAt: "2026-08-25T22:00:00.000Z",
  }), ["2026-08-25"]);
});
