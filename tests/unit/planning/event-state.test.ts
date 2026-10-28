import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData, readyHeaderSlot } from "@/lib/planning-header-data";
import type { EventConfirmation, EventRead } from "@/features/events/model/event-state";
import type { PlanningWorkspaceRead } from "@/features/planning/model/internal/planning-state-owner";
import type { FounderEvent, Task } from "@/lib/types";
const event = { id: 1, title: "Event", category: "other", startsAt: "2099-01-10T10:00:00.000Z", endsAt: "", location: "", description: "", audienceMode: "all", participantProfileIds: [], reminderDaysBefore: 7, reminderGeneratedAt: "", status: "planned", createdBy: "profile", createdAt: "r1", updatedAt: "r1" } satisfies FounderEvent;
const draft = { ...event, title: "Changed" };
const jan = { from: "2099-01-01T00:00:00.000Z", to: "2099-02-01T00:00:00.000Z" };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(adapter: Partial<import("@/features/planning/model/internal/planning-state-owner").PlanningStateAdapter> = {}, events = [event]) {
  return createPlanningState({ userId: "event-user", initialWorkspace: "events", initialData: { ...emptyPlanningShellState, events }, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, ...adapter } });
}
test("confirmed event changes invalidate only loaded calendar data and survive older workspace responses", async () => {
  const old = deferred<PlanningWorkspaceRead>(), header = deferred<typeof emptyPlanningHeaderData>(); let headerReads = 0;
  const { planning } = createPlanningState({ userId: "event-user", initialWorkspace: "events", initialData: { ...emptyPlanningShellState, events: [event] }, initialHeaderData: { ...emptyPlanningHeaderData, calendarEvents: readyHeaderSlot([]) }, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: () => old.promise, updateEvent: async () => ({ event: { ...event, title: "Confirmed", updatedAt: "r2" } }), readHeader: () => { headerReads++; return header.promise; } } });
  const reading = planning.refreshWorkspace("events");
  expect(await planning.updateEvent("edit-1", event, draft)).toMatchObject({ phase: "saved" });
  old.resolve({ data: { ...emptyPlanningShellState, events: [event] }, eventCoverage: { range: null, completeness: "complete" } }); await reading;
  expect(planning.events().events[0].title).toBe("Confirmed");
  expect(planning.header().slots.calendarEvents.readStatus).toBe("loading"); expect(headerReads).toBe(1);
  header.resolve({ ...emptyPlanningHeaderData, calendarEvents: readyHeaderSlot([]) }); await planning.refreshHeader(["calendarEvents"]);
});
test("a rejected event edit removes its own optimism and preserves an independent accepted task", async () => {
  const write = deferred<EventConfirmation>(), task = { id: "other", title: "Old", updatedAt: "r1" } as Task;
  const { planning } = createPlanningState({ userId: "event-user", initialWorkspace: "events", initialData: { ...emptyPlanningShellState, events: [event], tasks: [task] }, adapter: { saveTask: async () => ({ task: { ...task, title: "Confirmed task", updatedAt: "r2" } }), readWorkspace: async () => null, updateEvent: () => write.promise } });
  const saving = planning.updateEvent("edit-1", event, draft); expect(planning.events().events[0].title).toBe("Changed");
  await planning.saveTask(task, { title: "Confirmed task" }); write.reject(Object.assign(new Error("Invalid"), { status: 422 }));
  expect(await saving).toMatchObject({ phase: "rejected" }); expect(planning.events().events[0].title).toBe("Event"); expect(planning.taskDetail("other").task?.title).toBe("Confirmed task");
});
test("complete empty date ranges preserve outside events and protect against older overlapping resurrection", async () => {
  const old = deferred<EventRead>(); let reads = 0;
  const feb = { ...event, id: 2, startsAt: "2099-02-10T10:00:00.000Z" };
  const { planning } = fixture({ readEvents: async range => { if (++reads === 1) return old.promise; return { events: [], coverage: { range, completeness: "complete" } }; } }, [event, feb]);
  const reading = planning.refreshEvents({ from: "2099-01-05T00:00:00.000Z", to: "2099-02-01T00:00:00.000Z" });
  await planning.refreshEvents(jan); old.resolve({ events: [event], coverage: { range: { from: "2099-01-05T00:00:00.000Z", to: "2099-02-01T00:00:00.000Z" }, completeness: "complete" } }); await reading;
  expect(planning.events().events.map(item => item.id)).toEqual([2]);
});
test("bounded partial reads retain omitted rows; a lost create is retained and checked without replay", async () => {
  let writes = 0; const { planning } = fixture({ readEvents: async range => ({ events: [], coverage: { range, completeness: "partial" } }), createEvent: async () => { writes++; throw new Error("Lost response"); } });
  await planning.refreshEvents(jan); expect(planning.events().events).toHaveLength(1);
  expect(await planning.createEvent("new-event", draft)).toMatchObject({ phase: "unconfirmed" });
  await planning.checkEventOutcome("new-event"); await planning.createEvent("new-event", draft);
  expect(writes).toBe(1); expect(planning.events().operations[0]).toMatchObject({ phase: "unconfirmed", draft: { title: "Changed" }, checking: false });
});
test("lost edits block another submission for the identity and conflict retains inputs without overwriting", async () => {
  let writes = 0; const { planning } = fixture({ updateEvent: async () => { writes++; throw Object.assign(new Error("Version changed"), { status: 409, code: "event_version_conflict" }); } });
  expect(await planning.updateEvent("edit-1", event, draft)).toMatchObject({ phase: "conflict" }); expect(planning.events().operations[0].draft.title).toBe("Changed"); expect(planning.events().events[0].title).toBe("Event");
  expect(writes).toBe(1);
  const unknown = fixture({ updateEvent: async () => { throw new Error("Lost response"); } }).planning;
  await unknown.updateEvent("first", event, draft); expect(await unknown.updateEvent("second", event, draft)).toMatchObject({ phase: "unconfirmed" }); expect(unknown.events().operations).toHaveLength(1);
});
test("a confirmed row with failed audit is accepted once, with its partial-result warning", async () => {
  const { planning } = fixture({ createEvent: async () => ({ event: { ...event, id: 3, updatedAt: "r2" }, warning: "Event gespeichert; Protokollierung ausstehend." }) });
  expect(await planning.createEvent("new-event", draft)).toMatchObject({ phase: "saved", warning: expect.any(String) }); expect(planning.events().events.some(item => item.id === 3)).toBe(true);
});
test.each([null, "replacement"])("session replacement clears drafts and withholds late reads and writes (%s)", async replacement => {
  const read = deferred<EventRead>(), write = deferred<EventConfirmation>(); let session!: (id: string | null) => void;
  const { planning } = fixture({ subscribeSession: listener => { session = listener; return () => {}; }, readEvents: () => read.promise, updateEvent: () => write.promise });
  const reading = planning.refreshEvents(jan), saving = planning.updateEvent("edit-1", event, draft); session(replacement);
  read.resolve({ events: [event], coverage: { range: jan, completeness: "complete" } }); write.resolve({ event: { ...event, updatedAt: "r2" } }); await Promise.all([reading, saving]); expect(planning.events().events).toEqual([]); expect(planning.events().operations).toEqual([]);
});

test("an Event read denial withholds records and drafts, and a late earlier read cannot reopen the scope", async () => {
  const earlier = deferred<EventRead>(); let reads = 0;
  const { planning } = fixture({ readEvents: async () => { if (++reads === 1) return earlier.promise; throw Object.assign(new Error("Denied"), { status: 403 }); }, updateEvent: async () => { throw new Error("Lost response"); } });
  await planning.updateEvent("pending", event, draft);
  const oldRead = planning.refreshEvents(jan); await planning.refreshEvents(null);
  earlier.resolve({ events: [event], coverage: { range: jan, completeness: "complete" } }); await oldRead;
  expect(planning.events()).toMatchObject({ events: [], operations: [], readStatus: "forbidden", coverage: null });
  expect(await planning.updateEvent("blocked-after-denial", event, draft)).toMatchObject({ phase: "rejected" });
});
test("checking an uncertain Event revalidates an already loaded calendar but leaves idle slots idle", async () => {
  let reads = 0;
  const { planning } = createPlanningState({ userId: "event-user", initialWorkspace: "events", initialData: { ...emptyPlanningShellState, events: [event] }, initialHeaderData: { ...emptyPlanningHeaderData, calendarEvents: readyHeaderSlot([]) }, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, updateEvent: async () => { throw new Error("Lost"); }, readEvents: async range => ({ events: [{ ...event, title: "Saved remotely", updatedAt: "r2" }], coverage: { range, completeness: "complete" } }), readHeader: async () => { reads++; return { ...emptyPlanningHeaderData, calendarEvents: readyHeaderSlot([]) }; } } });
  await planning.updateEvent("uncertain", event, draft); await planning.refreshHeader(["calendarEvents"]); const before = reads;
  await planning.checkEventOutcome("uncertain"); expect(reads).toBe(before + 1); expect(planning.header().slots.quickLinks.readStatus).toBe("not-loaded");
});

test("a direct Event read uses its authoritative loaded calendar without an additional Header request", async () => {
  let headerReads = 0;
  const current = { ...event, title: "Authoritative", updatedAt: "r2" };
  const { planning } = createPlanningState({ userId: "event-user", initialWorkspace: "events", initialData: { ...emptyPlanningShellState, events: [event] }, initialHeaderData: { ...emptyPlanningHeaderData, calendarEvents: readyHeaderSlot([]) }, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readEvents: async range => ({ events: [current], coverage: { range, completeness: "complete" }, headerData: { ...emptyPlanningHeaderData, calendarEvents: readyHeaderSlot([{ ...current, endsAt: current.startsAt }]) } }), readHeader: async () => { headerReads++; return emptyPlanningHeaderData; } } });
  await planning.refreshEvents(); expect(headerReads).toBe(0); expect(planning.header().data.calendarEvents.data[0].title).toBe("Authoritative"); expect(planning.header().slots.quickLinks.readStatus).toBe("not-loaded");
});
test("a superseded-session Event result clears protected data before publication", async () => {
  const { planning } = fixture({ updateEvent: async () => { throw Object.assign(new Error("Replaced"), { status: 409, code: "session_superseded" }); } });
  expect(await planning.updateEvent("edit", event, draft)).toMatchObject({ phase: "session-ended" }); expect(planning.events().events).toEqual([]); expect(planning.events().operations).toEqual([]);
});

test("an older write confirmation does not resurrect an identity removed by a newer complete read", async () => {
  const write = deferred<EventConfirmation>();
  const { planning } = fixture({ updateEvent: () => write.promise, readEvents: async range => ({ events: [], coverage: { range, completeness: "complete" } }) });
  const saving = planning.updateEvent("old-write", event, draft); await planning.refreshEvents(jan);
  write.resolve({ event: { ...event, title: "Earlier confirmation", updatedAt: "r2" } }); await saving;
  expect(planning.events().events).toEqual([]); expect(planning.events().readStatus).toBe("stale");
});

test("checking an unknown write starts after its boundary rather than joining an older in-flight range read", async () => {
  const earlier = deferred<EventRead>(); let reads = 0;
  const { planning } = fixture({ readEvents: async range => { if (++reads === 1) return earlier.promise; return { events: [], coverage: { range, completeness: "complete" } }; }, updateEvent: async () => { throw new Error("Lost response"); } });
  const oldRead = planning.refreshEvents(); await planning.updateEvent("unknown", event, draft); await planning.checkEventOutcome("unknown");
  expect(reads).toBe(2); earlier.resolve({ events: [event], coverage: { range: null, completeness: "complete" } }); await oldRead;
  expect(planning.events().operations[0].phase).toBe("unconfirmed");
});

test("description/reminder-only Event changes leave an already loaded calendar current without a read", async () => {
  let reads = 0;
  const { planning } = createPlanningState({ userId: "event-user", initialWorkspace: "events", initialData: { ...emptyPlanningShellState, events: [event] }, initialHeaderData: { ...emptyPlanningHeaderData, calendarEvents: readyHeaderSlot([]) }, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, updateEvent: async () => ({ event: { ...event, description: "Changed context", reminderDaysBefore: 3, endsAt: event.startsAt, updatedAt: "r2" } }), readHeader: async () => { reads++; return emptyPlanningHeaderData; } } });
  await planning.updateEvent("description", event, { ...event, description: "Changed context", reminderDaysBefore: 3 }); expect(reads).toBe(0); expect(planning.header().slots.calendarEvents.readStatus).toBe("current");
});
