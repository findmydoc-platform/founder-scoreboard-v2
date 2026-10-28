import { expect, test } from "vitest";
import { createPlanningState, type PlanningStateAdapter } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { TaskDetailModel } from "@/features/tasks/model/task-detail-read-model";
import { emptyPlanningHeaderData, readyHeaderSlot } from "@/lib/planning-header-data";
import type { TaskBlocker } from "@/lib/types";
const task = taskDetailStoryTask({ id: "task", status: "In Arbeit", updatedAt: "r1", title: "Shown task" });
const submitted = { reason: "Dependency unavailable", impact: "Delivery delayed", needsHelpFrom: "Operations" };
const blocker: TaskBlocker = { id: 7, taskId: task.id, profileId: "profile", ...submitted, status: "open", createdAt: "2026-10-28T00:00:00Z", resolvedAt: "" };
function detail(patch = {}, blockers: TaskBlocker[] = [blocker]): TaskDetailModel { return { revision: "detail", project: emptyPlanningShellState.project, item: { ...task, status: "Blockiert", updatedAt: "r2", ...patch }, ancestors: [], children: [], relatedItems: [], people: [], sprints: [], discussion: { comments: [], externalComments: [] }, blockers, relationships: [], activity: [], reviews: [], coverage: { relationships: "complete" } }; }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes,no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(adapter: Partial<PlanningStateAdapter> = {}) { return createPlanningState({ userId: "user", initialData: { ...emptyPlanningShellState, tasks: [task] }, adapter: { saveTask: async (_,patch) => ({ task: { ...patch, updatedAt: "edit-r2" } }), readWorkspace: async () => null, ...adapter } }); }
test("a report separates pending Task display, confirmed Blocker and authoritative Task revision", async () => {
 const response = deferred<{ blocker: TaskBlocker }>(), read = deferred<{ model: TaskDetailModel }>(); let reads = 0;
 const { planning } = fixture({ reportBlocker: () => response.promise, readTaskDetail: () => { reads++; return read.promise; } });
 const writing = planning.reportTaskBlocker(task, submitted); expect(planning.board().tasks[0].status).toBe("Blockiert"); expect(planning.protectedCache()?.tasks[0]).toMatchObject({ status: "In Arbeit", updatedAt: "r1" }); expect(reads).toBe(0);
 response.resolve({ blocker }); expect(await writing).toMatchObject({ ok: true }); expect(planning.taskDetail(task.id).blockers).toEqual([blocker]); expect(planning.protectedCache()?.tasks[0].updatedAt).toBeUndefined(); expect(reads).toBe(1); expect(planning.taskBlockerReports(task.id)[0]).toMatchObject({ phase: "confirmed", taskReadStatus: "loading", submitted });
 read.resolve({ model: detail() }); await planning.checkTaskBlockerReport(planning.taskBlockerReports(task.id)[0].id); expect(planning.protectedCache()?.tasks[0]).toMatchObject({ status: "Blockiert", updatedAt: "r2" }); expect(planning.taskBlockerReports(task.id)[0]).toMatchObject({ phase: "confirmed", taskReadStatus: "current" });
});
test("an older Blocker rejection removes only its effects and retains concurrent confirmed Task edits", async () => {
 const response = deferred<{ blocker: TaskBlocker }>(), edit = deferred<{ task: { title: string; updatedAt: string } }>(); const { planning } = fixture({ reportBlocker: () => response.promise, saveTask: () => edit.promise });
 const editing = planning.saveTask(task, { title: "Independent confirmed title" }); const writing = planning.reportTaskBlocker(task, submitted); edit.resolve({ task: { title: "Independent confirmed title", updatedAt: "edit-r2" } }); await editing; response.reject(Object.assign(new Error("Review protected"), { status: 409 })); expect(await writing).toMatchObject({ ok: false, kind: "rejected" }); expect(planning.board().tasks[0]).toMatchObject({ title: "Independent confirmed title", status: "In Arbeit", updatedAt: "edit-r2" }); expect(planning.taskDetail(task.id).blockers).toEqual([]);
});


test("unknown reports retain metadata and read matching server fields without proving or replaying the report", async () => {
 let writes = 0, reads = 0, taskWrites = 0; const other = { ...task, id: "other" };
 const owner = createPlanningState({ userId: "user", initialData: { ...emptyPlanningShellState, tasks: [task, other] }, adapter: { readWorkspace: async () => null, reportBlocker: async () => { writes++; throw new Error("Confirmation lost"); }, readTaskDetail: async () => { reads++; return { model: detail() }; }, saveTask: async (_,patch) => { taskWrites++; return { task: { ...patch, updatedAt: "other-r2" } }; } } });
 expect(await owner.planning.reportTaskBlocker(task, submitted)).toMatchObject({ ok: false, kind: "unconfirmed" }); const report = owner.planning.taskBlockerReports(task.id)[0]; expect(report).toMatchObject({ submitted, blocker: null }); expect(reads).toBe(0);
 await Promise.all([owner.planning.checkTaskBlockerReport(report.id), owner.planning.checkTaskBlockerReport(report.id)]); expect(owner.planning.taskBlockerReports(task.id)[0]).toMatchObject({ phase: "unconfirmed", blocker: null, serverTask: { status: "Blockiert", updatedAt: "r2" } }); expect(owner.planning.taskDetail(task.id).blockers).toEqual([blocker]); expect(await owner.planning.reportTaskBlocker(task, submitted)).toMatchObject({ kind: "blocked" }); expect(await owner.planning.saveTask(task, { title: "Dependent" })).toMatchObject({ ok: false, code: "predecessor_unconfirmed" }); expect(await owner.planning.saveTask(other, { title: "Independent" })).toMatchObject({ ok: true }); expect({ writes, reads, taskWrites }).toEqual({ writes: 1, reads: 1, taskWrites: 1 });
});

test("a confirmed Blocker survives a failed Task refresh and a later readonly check recovers the real version", async () => {
 const failed = deferred<{ model: TaskDetailModel }>(); let reads = 0; const { planning } = fixture({ reportBlocker: async () => ({ blocker }), readTaskDetail: () => ++reads === 1 ? failed.promise : Promise.resolve({ model: detail() }) });
 await planning.reportTaskBlocker(task, submitted); const id = planning.taskBlockerReports(task.id)[0].id; const first = planning.checkTaskBlockerReport(id); failed.reject(new Error("Read unavailable")); await first; expect(planning.taskDetail(task.id).blockers).toEqual([blocker]); expect(planning.taskBlockerReports(task.id)[0]).toMatchObject({ phase: "confirmed", taskReadStatus: "unavailable" }); expect(planning.protectedCache()?.tasks[0].updatedAt).toBeUndefined();
 expect(await planning.checkTaskBlockerReport(id)).toMatchObject({ outcome: "not-pending", readStatus: "current" }); expect(planning.protectedCache()?.tasks[0].updatedAt).toBe("r2"); expect(reads).toBe(2);
});

test("a pre-report detail read cannot erase the Blocker or an independent confirmed field and is followed by a fresh read", async () => {
 const old = deferred<{ model: TaskDetailModel }>(), fresh = deferred<{ model: TaskDetailModel }>(), edit = deferred<{ task: { title: string; updatedAt: string } }>(); let reads = 0;
 const { planning } = fixture({ reportBlocker: async () => ({ blocker }), saveTask: () => edit.promise, readTaskDetail: () => ++reads === 1 ? old.promise : fresh.promise });
 const reading = planning.loadTaskDetail(task.id), editing = planning.saveTask(task, { title: "Confirmed title" }); await planning.reportTaskBlocker(task, submitted); edit.resolve({ task: { title: "Confirmed title", updatedAt: "edit-r2" } }); await editing;
 old.resolve({ model: detail({ status: "In Arbeit", updatedAt: "r1", title: "Old title" }, []) }); await reading; await Promise.resolve(); expect(planning.taskDetail(task.id).blockers).toEqual([blocker]); expect(planning.board().tasks[0].title).toBe("Confirmed title"); expect(reads).toBe(2);
 fresh.resolve({ model: detail({ title: "Confirmed title", updatedAt: "r3" }) }); await planning.checkTaskBlockerReport(planning.taskBlockerReports(task.id)[0].id); expect(planning.protectedCache()?.tasks[0]).toMatchObject({ title: "Confirmed title", updatedAt: "r3", status: "Blockiert" });
});

test.each([null, "replacement"])("ended session %s discards held Blocker receipts and submitted metadata", async account => {
 const response = deferred<{ blocker: TaskBlocker }>(); const owner = fixture({ reportBlocker: () => response.promise }); const writing = owner.planning.reportTaskBlocker(task, submitted); owner.internal.sessionChanged(account); response.resolve({ blocker }); expect(await writing).toMatchObject({ kind: "ended" }); expect(owner.planning.taskBlockerReports()).toEqual([]); expect(owner.planning.taskDetail(task.id).blockers).toEqual([]); expect(owner.planning.protectedCache()).toBeNull();
});

test.each([400, 403, 409, 404])("known HTTP%s rejection keeps the draft result distinct from lost confirmation", async status => {
 const { planning } = fixture({ reportBlocker: async () => { throw Object.assign(new Error("Rejected"), { status }); } }); expect(await planning.reportTaskBlocker(task, submitted)).toMatchObject({ ok: false, kind: "rejected", status }); expect(planning.board().tasks[0]).toMatchObject({ status: "In Arbeit", updatedAt: "r1" });
});

test("detail denial removes protected submissions, Blockers and late report publications", async () => {
 const response = deferred<{ blocker: TaskBlocker }>(); const { planning } = fixture({ reportBlocker: () => response.promise, readTaskDetail: async () => { throw Object.assign(new Error("Denied"), { status: 403 }); } }); const writing = planning.reportTaskBlocker(task, submitted); await planning.loadTaskDetail(task.id); response.resolve({ blocker }); expect(await writing).toMatchObject({ kind: "ended" }); expect(planning.taskBlockerReports()).toEqual([]); expect(planning.taskDetail(task.id).blockers).toEqual([]);
});


test.each([["confirmed", 1], ["unknown", 1], ["rejected", 0]] as const)("%s report invalidates only an already loaded notification Header slot (%i reads)", async (mode, expectedReads) => {
 let reads = 0; const header = { ...emptyPlanningHeaderData, notifications: readyHeaderSlot({ unreadCount: 2, items: [] }) };
 const { planning } = createPlanningState({ userId: "user", initialData: { ...emptyPlanningShellState, tasks: [task] }, initialHeaderData: header, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readTaskDetail: async () => ({ model: detail() }), readHeader: async slots => { expect(slots).toEqual(["notifications"]); reads++; return header; }, reportBlocker: async () => { if (mode !== "confirmed") throw Object.assign(new Error("Failure"), mode === "rejected" ? { status: 403 } : {}); return { blocker }; } } });
 await planning.reportTaskBlocker(task, submitted); expect(reads).toBe(expectedReads); expect(planning.header().slots.quickLinks.readStatus).toBe("not-loaded"); expect(planning.header().slots.calendarEvents.readStatus).toBe("not-loaded");
});

test("expiry invalidates a pending report before its receipt can publish", async () => {
 let now = 0; const response = deferred<{ blocker: TaskBlocker }>(); const { planning } = createPlanningState({ userId: "user", initialSession: { userId: "user", revision: "session", expiresAt: 1, user: { id: "user" } }, initialData: { ...emptyPlanningShellState, tasks: [task] }, adapter: { now: () => now, saveTask: async () => ({ task: {} }), readWorkspace: async () => null, reportBlocker: () => response.promise } });
 const writing = planning.reportTaskBlocker(task, submitted); now = 1000; response.resolve({ blocker }); expect(await writing).toMatchObject({ kind: "ended" }); expect(planning.taskBlockerReports()).toEqual([]); expect(planning.protectedCache()).toBeNull();
});

test("separate Task reports remain independent when the older report rejects", async () => {
 const response = deferred<{ blocker: TaskBlocker }>(), other = { ...task, id: "other" }, otherBlocker = { ...blocker, id: 8, taskId: other.id }; const owner = createPlanningState({ userId: "user", initialData: { ...emptyPlanningShellState, tasks: [task, other] }, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, reportBlocker: id => id === task.id ? response.promise : Promise.resolve({ blocker: otherBlocker }), readTaskDetail: async () => ({ model: { ...detail(), item: { ...other, status: "Blockiert", updatedAt: "other-r2" }, blockers: [otherBlocker] } }) } });
 const first = owner.planning.reportTaskBlocker(task, submitted); await owner.planning.reportTaskBlocker(other, submitted); await owner.planning.checkTaskBlockerReport(owner.planning.taskBlockerReports(other.id)[0].id); response.reject(Object.assign(new Error("Rejected"), { status: 409 })); await first; expect(owner.planning.taskDetail(task.id).task?.status).toBe("In Arbeit"); expect(owner.planning.taskDetail(other.id).task).toMatchObject({ status: "Blockiert", updatedAt: "other-r2" }); expect(owner.planning.taskDetail(other.id).blockers).toEqual([otherBlocker]);
});

test("partial or older Blocker reads cannot erase an actual confirmed report", async () => {
 const next = deferred<{ model: TaskDetailModel }>(); let reads = 0; const { planning } = fixture({ reportBlocker: async () => ({ blocker }), readTaskDetail: () => ++reads === 1 ? Promise.resolve({ model: detail() }) : next.promise });
 await planning.reportTaskBlocker(task, submitted); await planning.checkTaskBlockerReport(planning.taskBlockerReports(task.id)[0].id); const reading = planning.loadTaskDetail(task.id); next.resolve({ model: { ...detail({}, []), coverage: { relationships: "partial" } } }); await reading; expect(planning.taskDetail(task.id).blockers).toEqual([blocker]);
});


test("an unresolved report pauses overlapping ordering, assignment, removal and Sprint writes before transport", async () => {
 const sprint = { id: "sprint", name: "Sprint", status: "planning" as const, startDate: "2026-10-01", endDate: "2026-10-14", reviewDueAt: "2026-10-15T12:00:00Z", scoreLocked: false, updatedAt: "sprint-r1" }; const scheduled = { ...task, sprintId: sprint.id }, target = { ...task, id: "target", order: 20 }; let writes = 0;
 const { planning } = createPlanningState({ userId: "user", initialData: { ...emptyPlanningShellState, tasks: [scheduled,target], sprints: [sprint] }, adapter: { readWorkspace: async () => null, reportBlocker: async () => { throw new Error("Lost"); }, saveTask: async () => { writes++; return { task: {} }; }, moveBacklog: async () => { writes++; return { updates: [], completeness: "complete" }; }, assignBacklog: async () => { writes++; return { updates: [] }; }, removeTask: async () => { writes++; return {}; }, saveSprint: async () => { writes++; return { sprint }; } } });
 await planning.reportTaskBlocker(scheduled, submitted); expect(planning.taskSaves(task.id)[0]).toMatchObject({ phase: "unconfirmed", submitted: { status: "Blockiert" } }); expect((await planning.beginBacklogOrder([scheduled,target]).move(task.id,target.id,"after")).phase).toBe("blocked"); expect((await planning.beginBacklogAssignment([scheduled],[sprint],false).assign(sprint.id)).phase).toBe("blocked"); expect(await planning.withdrawTask(scheduled,"Withdraw request")).toMatchObject({ ok: false, kind: "unconfirmed" }); expect(await planning.beginSprintEdit(sprint).save({ name: "Dependent" })).toMatchObject({ ok: false, kind: "unconfirmed" }); expect(writes).toBe(0);
});


test("checking a fully confirmed report is already resolved and adds no further GET", async () => {
 let reads = 0; const { planning } = fixture({ reportBlocker: async () => ({ blocker }), readTaskDetail: async () => { reads++; return { model: detail() }; } }); await planning.reportTaskBlocker(task, submitted); const id = planning.taskBlockerReports(task.id)[0].id; await planning.checkTaskBlockerReport(id); const before = reads; await planning.checkTaskBlockerReport(id); expect(reads).toBe(before);
});


test("an incomplete Blocker receipt remains unconfirmed instead of fabricating omitted record fields", async () => {
 const { planning } = fixture({ reportBlocker: async () => ({ blocker: { id: blocker.id, taskId: task.id, reason: submitted.reason, status: "open" } as TaskBlocker }) }); expect(await planning.reportTaskBlocker(task, submitted)).toMatchObject({ ok: false, kind: "unconfirmed" }); expect(planning.taskDetail(task.id).blockers).toEqual([]); expect(planning.taskBlockerReports(task.id)[0]).toMatchObject({ submitted, blocker: null });
});
