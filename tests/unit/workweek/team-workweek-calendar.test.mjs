import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const draft = await import("../../../src/features/team-workweek/model/team-workweek-draft.ts");
const published = await import("../../../src/features/team-workweek/model/published-team-workweek.ts");
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

test("the current workweek matrix uses the same validity projection as the calendar", () => {
  const current = publication("current", "one", "2026-08-31", "2026-09-06", 2, windows({
    monday: [{ start: "09:00", end: "17:00" }],
  }));
  const prepared = publication("prepared", "one", "2026-09-07", null, 3, windows({
    monday: [{ start: "10:00", end: "18:00" }],
  }));

  const rows = model.projectCurrentCalendarWorkweekRows({
    calendarWorkweeks: [current, prepared],
    dateKey: "2026-09-06",
    profiles,
  });

  assert.equal(rows[0].workweek?.id, "current");
  assert.equal(rows[0].workweek?.windows.monday[0].start, "09:00");
  assert.equal(rows[1].workweek, null);
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

test("a first timestamped schedule clips activation-day history while retaining next week's regular template", () => {
  const windows = model.emptyTeamWorkweekWindows ? model.emptyTeamWorkweekWindows() : {monday:[],tuesday:[],wednesday:[{start:"09:00",end:"17:00"}],thursday:[],friday:[],saturday:[],sunday:[]};
  windows.wednesday=[{start:"09:00",end:"17:00"}];
  const first={id:"first",ownerProfileId:"p",effectiveFrom:"2026-10-12",effectiveAt:"2026-10-14T10:03:00Z",effectiveTo:null,timezone:"Europe/Berlin",publicationRevision:1,lastSyncAt:"2026-10-14T10:00:00Z",windows};
  assert.equal(model.selectCalendarWorkweek([first],"p","2026-10-13"),null);
  assert.deepEqual(model.calendarWindowsForDate(first,"2026-10-14"),[{start:"12:03",end:"17:00"}]);
  assert.deepEqual(model.calendarWindowsForDate(first,"2026-10-21"),[{start:"09:00",end:"17:00"}]);
});

test("the repeated Berlin DST hour cannot claim activity before the actual instant", () => {
  const windows={monday:[],tuesday:[],wednesday:[],thursday:[],friday:[],saturday:[],sunday:[{start:"02:00",end:"04:00"}]};
  const workweek={id:"dst",ownerProfileId:"p",effectiveFrom:"2026-10-19",effectiveAt:"2026-10-25T01:30:00Z",effectiveTo:null,timezone:"Europe/Berlin",publicationRevision:1,lastSyncAt:"2026-10-25T00:00:00Z",windows};
  const result=model.projectCalendarWorktimes({calendarWorkweeks:[workweek],profiles:[{id:"p",name:"P"}],dateKey:"2026-10-25",now:new Date("2026-10-25T00:45:00Z")});
  assert.equal(result[0].workingNow,false);
});


test("same-day replacements retain elapsed windows and choose the new template only after their instant",()=>{
  const oldWindows={monday:[],tuesday:[],wednesday:[{start:"09:00",end:"17:00"}],thursday:[],friday:[],saturday:[],sunday:[]};
  const rows=[{id:"old",ownerProfileId:"p",effectiveFrom:"2026-10-12",effectiveAt:"2026-10-12T00:00:00Z",effectiveUntil:"2026-10-14T10:03:00Z",effectiveTo:"2026-10-14",timezone:"Europe/Berlin",publicationRevision:1,lastSyncAt:"2026-10-12T00:00:00Z",windows:oldWindows},{id:"new",ownerProfileId:"p",effectiveFrom:"2026-10-12",effectiveAt:"2026-10-14T10:03:00Z",effectiveTo:null,timezone:"Europe/Berlin",publicationRevision:2,lastSyncAt:"2026-10-14T10:00:00Z",windows:{...oldWindows,wednesday:[{start:"13:00",end:"18:00"}]}}];
  const projected=model.projectCalendarWorktimes({calendarWorkweeks:rows,profiles:[{id:"p",name:"P"}],dateKey:"2026-10-14",now:new Date("2026-10-14T10:04:00Z")});
  assert.deepEqual(projected[0].windows,[{start:"09:00",end:"12:03"},{start:"13:00",end:"18:00"}]);
});

test("replacement inside the repeated hour retains the first 02:45 segment as historical planned time",()=>{
  const windows={monday:[],tuesday:[],wednesday:[],thursday:[],friday:[],saturday:[],sunday:[{start:"01:00",end:"04:00"}]};
  const old={id:"old-fold",ownerProfileId:"p",effectiveFrom:"2026-10-19",effectiveUntil:"2026-10-25T01:30:00Z",effectiveTo:"2026-10-25",timezone:"Europe/Berlin",publicationRevision:1,lastSyncAt:"2026-10-19T00:00:00Z",windows};
  const result=model.projectCalendarWorktimes({calendarWorkweeks:[old],profiles:[{id:"p",name:"P"}],dateKey:"2026-10-25",now:new Date("2026-10-25T00:45:00Z")});
  assert.equal(result[0].workingNow,true);
  assert.equal(result[0].windows[0].endsAt,"2026-10-25T01:30:00.000Z");
  assert.match(model.calendarWindowLabel(result[0].windows[0]),/MESZ.*MEZ/);
});


test("repeated same-week corrections keep three non-overlapping day segments and switch exactly at each boundary",()=>{
  const base={ownerProfileId:"p",effectiveFrom:"2026-10-12",timezone:"Europe/Berlin",lastSyncAt:"2026-10-14T07:00:00Z"};
  const windows={monday:[],tuesday:[],wednesday:[{start:"09:00",end:"18:00"}],thursday:[],friday:[],saturday:[],sunday:[]};
  const rows=[
    {...base,id:"one",publicationRevision:1,effectiveAt:"2026-10-12T00:00:00Z",effectiveUntil:"2026-10-14T10:03:00Z",effectiveTo:"2026-10-14",windows},
    {...base,id:"two",publicationRevision:2,effectiveAt:"2026-10-14T10:03:00Z",effectiveUntil:"2026-10-14T12:03:00Z",effectiveTo:"2026-10-14",windows},
    {...base,id:"three",publicationRevision:3,effectiveAt:"2026-10-14T12:03:00Z",effectiveTo:null,windows},
  ];
  assert.equal(model.selectCalendarWorkweek(rows,"p","2026-10-14",new Date("2026-10-14T10:02:59Z")).id,"one");
  assert.equal(model.selectCalendarWorkweek(rows,"p","2026-10-14",new Date("2026-10-14T10:03:00Z")).id,"two");
  assert.equal(model.selectCalendarWorkweek(rows,"p","2026-10-14",new Date("2026-10-14T12:03:00Z")).id,"three");
  const result=model.projectCalendarWorktimes({calendarWorkweeks:rows,profiles:[{id:"p",name:"P"}],dateKey:"2026-10-14",now:new Date("2026-10-14T12:03:00Z")});
  assert.deepEqual(result[0].windows,[{start:"09:00",end:"12:03"},{start:"12:03",end:"14:03"},{start:"14:03",end:"18:00"}]);
  assert.equal(result[0].workingNow,true);
});

test("spring normalization omits empty windows and unites strictly overlapping actual intervals",()=>{
  const sunday=[{start:"02:00",end:"02:30"},{start:"02:30",end:"03:00"},{start:"03:00",end:"03:30"},{start:"03:30",end:"04:00"}];
  const entry=publication("gap","one","2026-03-23",null,1,windows({sunday}));
  assert.deepEqual(model.calendarWindowsForDate(entry,"2026-03-29").map(({start,end})=>({start,end})),[{start:"03:00",end:"03:30"},{start:"03:30",end:"04:00"}]);
  const projected=model.projectCalendarWorktimes({calendarWorkweeks:[entry],profiles,dateKey:"2026-03-29",now:new Date("2026-03-29T01:15:00Z")});
  assert.equal(projected[0].workingNow,true);
});

test("autumn endpoints select the first repeated label, never the second fold",()=>{
  const entry=publication("fold","one","2026-10-19",null,1,windows({sunday:[{start:"02:15",end:"02:45"}]}));
  const result=model.projectCalendarWorktimes({calendarWorkweeks:[entry],profiles,dateKey:"2026-10-25",now:new Date("2026-10-25T01:30:00Z")});
  assert.equal(result[0].workingNow,false);
});

test("a Wednesday correction with a higher revision ends at the retained Monday across Team and calendar", () => {
  const rows = [
    { ...publication("old", "one", "2026-10-12", "2026-10-14", 1, windows({ wednesday: [{ start: "09:00", end: "17:00" }] })), effectiveUntil: "2026-10-14T10:03:00Z" },
    { ...publication("monday", "one", "2026-10-19", null, 2, windows({ monday: [{ start: "10:00", end: "16:00" }], wednesday: [{ start: "10:00", end: "16:00" }] })), effectiveAt: "2026-10-18T22:00:00Z" },
    { ...publication("correction", "one", "2026-10-12", "2026-10-18", 3, windows({ monday: [{ start: "13:00", end: "18:00" }], wednesday: [{ start: "13:00", end: "18:00" }] })), effectiveAt: "2026-10-14T10:03:00Z", effectiveUntil: "2026-10-18T22:00:00Z" },
  ];
  assert.deepEqual(published.selectVisibleTeamWorkweeks(rows, "2026-10-14", new Date("2026-10-14T11:00:00Z")).map(({ id, phase }) => ({ id, phase })), [{ id: "correction", phase: "current" }, { id: "monday", phase: "prepared" }]);
  assert.deepEqual(model.projectCalendarWorktimes({ calendarWorkweeks: rows, profiles, dateKey: "2026-10-14", now: new Date("2026-10-14T11:00:00Z") })[0].windows, [{ start: "09:00", end: "12:03" }, { start: "13:00", end: "18:00" }]);
  assert.equal(model.selectCalendarWorkweek(rows, "one", "2026-10-19", new Date("2026-10-18T22:00:00Z")).id, "monday");
  assert.deepEqual(model.projectCalendarWorktimes({ calendarWorkweeks: rows, profiles, dateKey: "2026-10-19", now: new Date("2026-10-19T09:00:00Z") })[0].windows, [{ start: "10:00", end: "16:00" }]);
  assert.deepEqual(model.projectCalendarWorktimes({ calendarWorkweeks: rows, profiles, dateKey: "2026-10-21", now: new Date("2026-10-21T09:00:00Z") })[0].windows, [{ start: "10:00", end: "16:00" }]);
});
