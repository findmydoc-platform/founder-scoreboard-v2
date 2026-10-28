import { expect, test } from "vitest";
import { createPlanningState, type PlanningStateAdapter, type PlanningWorkspaceRead } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { TaskDetailModel } from "@/features/tasks/model/task-detail-read-model";
import type { Task } from "@/lib/types";
import { emptyPlanningHeaderData, readyHeaderSlot } from "@/lib/planning-header-data";
const tasks = ["a","b","c"].map((id,index) => ({ id, title: `Task ${id}`, taskType: "deliverable", status: "Offen", order: (index+1)*10, updatedAt: `${id}-r1`, sprintId: "" } as Task));
function fixture(adapter: Partial<PlanningStateAdapter> = {}) { return createPlanningState({ userId: "ordering-user", initialWorkspace: "backlog", initialData: { ...emptyPlanningShellState, tasks }, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, ...adapter } }); }
function deferred<T>() { let resolve!: (value:T) => void; let reject!: (error:Error) => void; const promise = new Promise<T>((yes,no) => { resolve=yes; reject=no; }); return { promise, resolve, reject }; }
test("move publishes one pending order and accepts actual renumbered fields across common Task identities", async () => {
 const response = deferred<{ updates: { id: string; sortOrder: number; updatedAt: string }[]; completeness: "complete" }>(); const { planning } = fixture({ moveBacklog: () => response.promise });
 const editor = planning.beginBacklogOrder(tasks), writing = editor.move("c","a","before");
 expect(planning.backlog().model.items.find(task => task.id === "c")?.order).toBe(10); expect(editor.view().phase).toBe("saving");
 response.resolve({ completeness: "complete", updates: [{ id: "c", sortOrder: 10, updatedAt: "c-r2" }, { id: "a", sortOrder: 20, updatedAt: "a-r2" }, { id: "b", sortOrder: 30, updatedAt: "b-r2" }] });
 expect(await writing).toMatchObject({ phase: "saved", affectedCount: 3 }); expect(planning.taskDetail("b").task).toMatchObject({ title: "Task b", order: 30, updatedAt: "b-r2" });
});

test("older reads in another loaded scope cannot introduce a stale unknown affected identity before a bound resolution read", async () => {
 const old = deferred<PlanningWorkspaceRead>(), fresh = deferred<PlanningWorkspaceRead>(); let reads = 0;
 const { planning } = fixture({ readWorkspace: workspace => { reads++; return workspace === "planning" ? old.promise : fresh.promise; }, moveBacklog: async () => ({ completeness: "complete", updates: [{ id: "unknown", sortOrder: 40, updatedAt: "unknown-r2" }, { id: "c", sortOrder: 10, updatedAt: "c-r2" }] }) });
 const reading = planning.refreshWorkspace("planning"); await planning.beginBacklogOrder(tasks).move("c","a","before");
 old.resolve({ data: { ...emptyPlanningShellState, tasks: [...tasks, { ...tasks[0], id: "unknown", order: 1, updatedAt: "unknown-r1" }] }, coverage: { tasks: "partial" } }); await reading;
 expect(planning.taskDetail("unknown").task).toBeNull(); expect(reads).toBe(2);
 fresh.resolve({ data: { ...emptyPlanningShellState, tasks: [...tasks, { ...tasks[0], id: "unknown", order: 40, updatedAt: "unknown-r2" }] }, coverage: { tasks: "partial" } });
 await Promise.resolve(); await Promise.resolve(); expect(planning.taskDetail("unknown").task).toMatchObject({ order: 40, updatedAt: "unknown-r2" });
});

test("unknown order retains its relative intent, blocks related writes and permits independent records without replay", async () => {
 let writes = 0, reads = 0, taskWrites = 0; const independent = { ...tasks[0], id: "epic", taskType: "epic" as const };
 const { planning } = createPlanningState({ userId: "ordering-user", initialWorkspace: "backlog", initialData: { ...emptyPlanningShellState, tasks: [...tasks,independent] }, adapter: { moveBacklog: async () => { writes++; throw new Error("Lost"); }, saveTask: async (task,patch) => { taskWrites++; return { task: { ...patch, id: task.id, updatedAt: "saved" } }; }, readWorkspace: async () => { reads++; return { data: { ...emptyPlanningShellState, tasks }, coverage: { tasks: "partial" } }; } } });
 const editor = planning.beginBacklogOrder(tasks); expect((await editor.move("c","a","before")).phase).toBe("unconfirmed"); expect((await planning.saveTask(tasks[1],{ title: "Dependent" })).ok).toBe(false); expect((await planning.saveTask(independent,{ title: "Independent" })).ok).toBe(true);
 await editor.checkOutcome(); await editor.move("c","a","before"); expect(writes).toBe(1); expect(reads).toBe(1); expect(taskWrites).toBe(1); expect(editor.view()).toMatchObject({ phase: "unconfirmed", source: { id: "c" }, target: { id: "a" }, placement: "before" });
});
test("known rejection removes only its order overlay and keeps independent confirmed Task fields", async () => {
 const response = deferred<{ updates: []; completeness: "complete" }>(); const independent = { ...tasks[0],id:"epic",taskType:"epic" as const };
 const { planning } = createPlanningState({ userId:"ordering-user", initialWorkspace:"backlog", initialData:{ ...emptyPlanningShellState,tasks:[...tasks,independent] }, adapter:{ readWorkspace:async()=>null, moveBacklog:()=>response.promise, saveTask:async()=>({task:{id:"epic",title:"Confirmed independent",updatedAt:"epic-r2"}}) } });
 const writing=planning.beginBacklogOrder(tasks).move("c","a","before"); await planning.saveTask(independent,{title:"Confirmed independent"}); response.reject(Object.assign(new Error("Policy rejection"),{status:409})); expect((await writing).phase).toBe("rejected"); expect(planning.taskDetail("c").task?.order).toBe(30); expect(planning.taskDetail("epic").task?.title).toBe("Confirmed independent");
});
test("original source and target bases survive a read and conflict resave requires fresh records for both", async () => {
 let omit=false,writes=0; const current=tasks.map(task=>({...task,updatedAt:`${task.id}-foreign`})); const {planning}=fixture({readWorkspace:async()=>({data:{...emptyPlanningShellState,tasks:omit?[current[0]]:current},coverage:{tasks:"partial"}}),moveBacklog:async(source,target)=>{writes++;expect(source.updatedAt).toBe("c-foreign");expect(target.updatedAt).toBe("a-foreign");return{completeness:"complete",updates:[]};}});
 const editor=planning.beginBacklogOrder(tasks);await planning.refreshWorkspace("backlog");expect((await editor.move("c","a","before")).phase).toBe("conflict");expect(writes).toBe(0);omit=true;expect(await editor.refreshConflict()).toBe(false);omit=false;expect(await editor.refreshConflict()).toBe(true);expect((await editor.resave()).phase).toBe("saved");expect(writes).toBe(1);
});


test("an unresolved Sprint schedule pauses related global ranking before transport", async () => {
 const sprint = { id: "sprint", name: "Sprint", status: "planning" as const, startDate: "2026-10-01", endDate: "2026-10-14", reviewDueAt: "2026-10-15T12:00:00Z", scoreLocked: false, updatedAt: "sprint-r1" };
 const scheduled = tasks.map(task => ({ ...task, sprintId: sprint.id })); let writes = 0;
 const { planning } = createPlanningState({ userId: "ordering-user", initialWorkspace: "backlog", initialData: { ...emptyPlanningShellState, tasks: scheduled, sprints: [sprint] }, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, saveSprint: async () => { throw new Error("Lost schedule confirmation"); }, moveBacklog: async () => { writes++; return { updates: [], completeness: "complete" }; } } });
 await planning.beginSprintEdit(sprint).save({ startDate: "2026-10-02" });
 expect((await planning.beginBacklogOrder(scheduled).move("c", "a", "before")).phase).toBe("blocked"); expect(writes).toBe(0);
});

test("ambiguous duplicate receipts confirm no arbitrary version while independent valid patches remain accepted", async () => {
 const { planning } = fixture({ moveBacklog: async () => ({ completeness: "complete", updates: [{ id: "a", sortOrder: 20, updatedAt: "a-one" }, { id: "a", sortOrder: 40, updatedAt: "a-two" }, { id: "c", sortOrder: 10, updatedAt: "c-confirmed" }] }) });
 const editor = planning.beginBacklogOrder(tasks); expect((await editor.move("c", "a", "before")).phase).toBe("unconfirmed");
 expect(planning.protectedCache()?.tasks.find(task => task.id === "a")).toMatchObject({ order: 10, updatedAt: "a-r1" }); expect(planning.taskDetail("c").task).toMatchObject({ order: 10, updatedAt: "c-confirmed" }); expect(editor.view().confirmedIds).toEqual(["c"]);
});


test.each([[403, undefined, "rejected"], [409, undefined, "rejected"], [409, "backlog_order_revision_conflict", "conflict"], [503, undefined, "unconfirmed"]] as const)("status %s and code %s retain the actual failure classification", async (status, code, phase) => {
 const { planning } = fixture({ moveBacklog: async () => { throw Object.assign(new Error("Failure"), { status, code }); } });
 expect((await planning.beginBacklogOrder(tasks).move("c", "a", "before")).phase).toBe(phase);
});

test.each([null, "replacement"])("ended account %s discards a held order receipt and its protected intent", async account => {
 const response = deferred<{ updates: { id: string; sortOrder: number; updatedAt: string }[]; completeness: "complete" }>(); const owner = fixture({ moveBacklog: () => response.promise });
 const editor = owner.planning.beginBacklogOrder(tasks), writing = editor.move("c", "a", "before"); owner.internal.sessionChanged(account);
 response.resolve({ completeness: "complete", updates: [{ id: "c", sortOrder: 10, updatedAt: "late" }] });
 expect((await writing).phase).toBe("ended"); expect(owner.planning.backlogOrders()).toEqual([]); expect(owner.planning.protectedCache()).toBeNull(); expect(editor.view()).toMatchObject({ phase: "ended", source: null, target: null });
});

test("expiry and later read denial prevent late order publication", async () => {
 let now = 0; const response = deferred<{ updates: []; completeness: "complete" }>();
 const owner = createPlanningState({ userId: "ordering-user", initialSession: { userId: "ordering-user", expiresAt: 1, revision: "session-r1", user: { id: "ordering-user" } }, initialWorkspace: "backlog", initialData: { ...emptyPlanningShellState, tasks }, adapter: { now: () => now, saveTask: async () => ({ task: {} }), readWorkspace: async () => null, moveBacklog: () => response.promise } });
 const editor = owner.planning.beginBacklogOrder(tasks), writing = editor.move("c", "a", "before"); now = 1000; response.resolve({ updates: [], completeness: "complete" }); expect((await writing).phase).toBe("ended"); expect(owner.planning.protectedCache()).toBeNull();
 const denied = fixture({ moveBacklog: async () => { throw new Error("Lost"); }, readWorkspace: async () => { throw Object.assign(new Error("Denied"), { status: 403 }); } });
 const pending = denied.planning.beginBacklogOrder(tasks); await pending.move("c", "a", "before"); expect(await pending.checkOutcome()).toBe(false); expect(denied.planning.backlogOrders()).toEqual([]); expect(denied.planning.backlog().model.items).toEqual([]); expect(pending.view().source).toBeNull();
});

test("read-only checks coalesce and partial receipts preserve membership fields without replay", async () => {
 const read = deferred<PlanningWorkspaceRead>(); let reads = 0, writes = 0;
 const differentScopes = tasks.map((task,index) => ({ ...task, sprintId: `sprint-${index}`, parentTaskId: `parent-${index}` }));
 const { planning } = createPlanningState({ userId: "ordering-user", initialWorkspace: "backlog", initialData: { ...emptyPlanningShellState, tasks: differentScopes }, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: () => { reads++; return read.promise; }, moveBacklog: async () => { writes++; return { completeness: "partial", updates: [{ id: "c", sortOrder: 10, updatedAt: "c-confirmed" }] }; } } });
 const editor = planning.beginBacklogOrder(differentScopes); expect((await editor.move("c", "a", "before")).phase).toBe("unconfirmed"); expect(reads).toBe(0);
 expect(planning.taskDetail("c").task).toMatchObject({ sprintId: "sprint-2", parentTaskId: "parent-2", updatedAt: "c-confirmed" }); expect(planning.protectedCache()?.tasks.find(task => task.id === "a")?.updatedAt).toBe("a-r1");
 const first = editor.checkOutcome(), second = editor.checkOutcome(); expect(reads).toBe(1); read.resolve({ data: { ...emptyPlanningShellState, tasks: differentScopes }, coverage: { tasks: "partial" } }); await Promise.all([first,second]); expect(editor.view().phase).toBe("unconfirmed"); expect(writes).toBe(1);
});

test("a complete no-op and normal known-row success add no workspace or Header reads", async () => {
 let reads = 0; const { planning } = fixture({ readWorkspace: async () => { reads++; return null; }, moveBacklog: async () => ({ completeness: "complete", updates: [] }) });
 expect(await planning.beginBacklogOrder(tasks).move("c", "a", "before")).toMatchObject({ phase: "saved", affectedCount: 0 }); expect(reads).toBe(0); expect(planning.taskDetail("c").task?.order).toBe(30);
});


test("integrated Sprint closure and global rank changes block each other's affected records", async () => {
 const sprint = { id: "sprint", name: "Sprint", status: "review" as const, startDate: "2020-01-01", endDate: "2020-01-14", reviewDueAt: "2020-01-16T22:59:59Z", scoreLocked: false, updatedAt: "sprint-r1" };
 const scheduled = tasks.map(task => ({ ...task, sprintId: sprint.id })); const input = { firstSprintNumber: 1, anchorStartDate: "2099-01-01", rhythmWeeks: 2, horizonWeeks: 1, targetSprintNumber: 2 }; let ranks = 0, locks = 0;
 function owner() { return createPlanningState({ userId: "ordering-user", initialWorkspace: "backlog", initialData: { ...emptyPlanningShellState, tasks: scheduled, sprints: [sprint] }, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, lockSprint: async () => { locks++; throw new Error("Lost lock confirmation"); }, moveBacklog: async () => { ranks++; throw new Error("Lost rank confirmation"); } } }).planning; }
 const locked = owner(); await locked.beginSprintLock(sprint, scheduled).lock(input); expect((await locked.beginBacklogOrder(scheduled).move("c", "a", "before")).phase).toBe("blocked"); expect(ranks).toBe(0);
 const ordered = owner(); await ordered.beginBacklogOrder(scheduled).move("c", "a", "before"); expect(await ordered.beginSprintLock(sprint, scheduled).lock(input)).toMatchObject({ ok: false, kind: "unconfirmed" }); expect(locks).toBe(1); expect(ranks).toBe(1);
});


test("concurrent conflict comparisons share the same fresh source and target evidence", async () => {
 const read = deferred<PlanningWorkspaceRead>(); const { planning } = fixture({ readWorkspace: () => read.promise, moveBacklog: async () => { throw Object.assign(new Error("Changed"), { status: 409, code: "backlog_order_revision_conflict" }); } }); const editor = planning.beginBacklogOrder(tasks); await editor.move("c", "a", "before");
 const first = editor.refreshConflict(), second = editor.refreshConflict(); read.resolve({ data: { ...emptyPlanningShellState, tasks }, coverage: { tasks: "partial" } }); expect(await Promise.all([first, second])).toEqual([true, true]); expect(editor.view()).toMatchObject({ canResave: true }); expect(editor.view().serverTasks.map(task => task.id)).toEqual(["a", "c"]);
});


test.each(["saved", "unknown"] as const)("%s rank writes leave loaded Header slots untouched", async mode => {
 let headerReads = 0; const header = { ...emptyPlanningHeaderData, notifications: readyHeaderSlot({ unreadCount: 3, items: [] }) };
 const { planning } = createPlanningState({ userId: "ordering-user", initialWorkspace: "backlog", initialData: { ...emptyPlanningShellState, tasks }, initialHeaderData: header, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readHeader: async () => { headerReads++; return header; }, moveBacklog: async () => { if (mode === "unknown") throw new Error("Lost"); return { completeness: "complete", updates: [{ id: "c", sortOrder: 10, updatedAt: "c-r2" }] }; } } });
 await planning.beginBacklogOrder(tasks).move("c", "a", "before"); expect(headerReads).toBe(0); expect(planning.header().slots.notifications.readStatus).toBe("current");
});


test("an older detail response cannot introduce a stale identity covered by a newer rank receipt", async () => {
 const old = deferred<{ model: TaskDetailModel }>(), fresh = deferred<PlanningWorkspaceRead>(); const unknown = { ...tasks[0], id: "unknown", order: 1, updatedAt: "unknown-r1" };
 const { planning } = fixture({ readTaskDetail: () => old.promise, readWorkspace: () => fresh.promise, moveBacklog: async () => ({ completeness: "complete", updates: [{ id: unknown.id, sortOrder: 40, updatedAt: "unknown-r2" }] }) });
 const loading = planning.loadTaskDetail(unknown.id); await planning.beginBacklogOrder(tasks).move("c", "a", "before"); old.resolve({ model: { revision: "old", project: emptyPlanningShellState.project, item: unknown, ancestors: [], children: [], relatedItems: [], people: [], sprints: [], discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [] } }); await loading; expect(planning.taskDetail(unknown.id)).toMatchObject({ task: null, readStatus: "stale" });
 fresh.resolve({ data: { ...emptyPlanningShellState, tasks: [...tasks, { ...unknown, order: 40, updatedAt: "unknown-r2" }] }, coverage: { tasks: "partial" } }); await Promise.resolve(); await Promise.resolve(); expect(planning.taskDetail(unknown.id).task).toMatchObject({ order: 40, updatedAt: "unknown-r2" });
});
