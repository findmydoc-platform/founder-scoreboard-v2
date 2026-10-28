import { expect, test } from "vitest";
import { createPlanningState, type PlanningStateAdapter } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningHeaderData, readyHeaderSlot } from "@/lib/planning-header-data";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { Task, Sprint } from "@/lib/types";
const task = { id: "a", title: "Deliverable A", taskType: "deliverable", approvalStatus: "approved", parentTaskId: "initiative", assigneeId: "founder", status: "Offen", sprintId: "", updatedAt: "r1" } as Task;
const sprint = { id: "sprint", name: "Sprint 1", scoreLocked: false, updatedAt: "s1" } as Sprint;
function fixture(adapter: Partial<PlanningStateAdapter> = {}) { return createPlanningState({ userId: "backlog-user", initialWorkspace: "backlog", initialData: { ...emptyPlanningShellState, tasks: [task], sprints: [sprint] }, adapter: { readWorkspace: async () => null, saveTask: async () => ({ task: {} }), ...adapter } }); }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes,no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
test("assignment immediately projects its own effect and confirms only returned fields across Backlog and detail", async () => {
 const write = deferred<{ updates: Partial<Task>[] }>(); const { planning } = fixture({ assignBacklog: () => write.promise });
 const editor = planning.beginBacklogAssignment([task], [sprint], false); const saving = editor.assign(sprint.id);
 expect(planning.backlog().model.items[0].sprintId).toBe(sprint.id); expect(editor.view().phase).toBe("saving");
 write.resolve({ updates: [{ id: task.id, sprintId: sprint.id, scoreRelevant: true, updatedAt: "r2" }] });
 expect(await saving).toMatchObject({ phase: "saved", confirmedCount: 1 }); expect(planning.taskDetail(task.id).task).toMatchObject({ title: task.title, sprintId: sprint.id, updatedAt: "r2" });
});

test("unknown assignment blocks related Task and Sprint edits while independent records continue and checking never replays", async () => {
 let writes = 0, reads = 0, taskWrites = 0, sprintWrites = 0;
 const other = { ...task, id: "other", title: "Independent" }, independentSprint = { ...sprint, id: "other-sprint" };
 const { planning } = createPlanningState({ userId: "backlog-user", initialWorkspace: "backlog", initialData: { ...emptyPlanningShellState, tasks: [task, other], sprints: [sprint, independentSprint] }, adapter: { readWorkspace: async () => { reads++; return { data: { ...emptyPlanningShellState, tasks: [{ ...task, sprintId: sprint.id }], sprints: [sprint] }, coverage: { tasks: "partial", sprints: "partial" } }; }, saveTask: async (task,patch) => { taskWrites++; return { task: { ...patch, id: task.id, updatedAt: "saved" } }; }, saveSprint: async (basis,patch) => { sprintWrites++; return { sprint: { ...basis, ...patch, updatedAt: "saved" } }; }, assignBacklog: async () => { writes++; throw new Error("Lost response"); } } });
 const editor = planning.beginBacklogAssignment([task], [sprint], false); expect((await editor.assign(sprint.id)).phase).toBe("unconfirmed"); expect(planning.taskDetail(task.id).saveStatus).toBe("unconfirmed"); expect(planning.taskSaves(task.id)[0].submitted?.sprintId).toBe(sprint.id);
 expect((await planning.saveTask(task, { title: "Dependent" })).ok).toBe(false); expect((await planning.beginSprintEdit(sprint).save({ name: "Dependent" })).ok).toBe(false);
 expect((await planning.saveTask(other, { title: "Independent saved" })).ok).toBe(true); expect((await planning.beginSprintEdit(independentSprint).save({ name: "Independent saved" })).ok).toBe(true);
 await editor.checkOutcome(); await editor.assign(sprint.id); expect(writes).toBe(1); expect(reads).toBe(1); expect(taskWrites).toBe(1); expect(sprintWrites).toBe(1); expect(editor.view().phase).toBe("unconfirmed");
});
test("incomplete bulk confirmation accepts actual rows, retains uncovered effects and never claims all selections saved", async () => {
 const second = { ...task, id: "b" }; const { planning } = createPlanningState({ userId: "backlog-user", initialWorkspace: "backlog", initialData: { ...emptyPlanningShellState, tasks: [task, second], sprints: [sprint] }, adapter: { readWorkspace: async () => null, saveTask: async () => ({ task: {} }), assignBacklog: async () => ({ updates: [{ id: task.id, sprintId: sprint.id, scoreRelevant: true, updatedAt: "r2" }] }) } });
 const editor = planning.beginBacklogAssignment([task, second], [sprint], true); expect(await editor.assign(sprint.id)).toMatchObject({ phase: "unconfirmed", confirmedCount: 1 }); expect(planning.taskDetail(task.id).task?.updatedAt).toBe("r2"); expect(planning.taskDetail(second.id).task?.updatedAt).toBe("r1"); expect(editor.view().tasks.map(task => task.id)).toEqual(["a", "b"]);
});
test.each([403,409])("known permission or lock rejection removes only this effect (%s)", async status => {
 const writing = deferred<{ updates: Partial<Task>[] }>(); const other = { ...task, id: "other" };
 const { planning } = createPlanningState({ userId: "backlog-user", initialWorkspace: "backlog", initialData: { ...emptyPlanningShellState, tasks: [task, other], sprints: [sprint] }, adapter: { readWorkspace: async () => null, saveTask: async () => ({ task: { id: other.id, title: "Independent confirmed", updatedAt: "other-r2" } }), assignBacklog: () => writing.promise } });
 const editor = planning.beginBacklogAssignment([task], [sprint], false); const pending = editor.assign(sprint.id); await planning.saveTask(other, { title: "Independent confirmed" }); writing.reject(Object.assign(new Error("Rejected by policy"), { status })); expect((await pending).phase).toBe("rejected"); expect(planning.taskDetail(task.id).task?.sprintId).toBe(""); expect(planning.taskDetail(other.id).task?.title).toBe("Independent confirmed");
});
test("displayed Sprint and Task versions stay original after reads and conflict needs a newly returned comparison basis", async () => {
 let omit = false, writes = 0; const freshTask = { ...task, updatedAt: "foreign" }, freshSprint = { ...sprint, updatedAt: "foreign-sprint" };
 const { planning } = fixture({ readWorkspace: async () => ({ data: { ...emptyPlanningShellState, tasks: omit ? [] : [freshTask], sprints: omit ? [] : [freshSprint] }, coverage: { tasks: "partial", sprints: "partial" } }), assignBacklog: async (tasks,target) => { writes++; expect(tasks[0].updatedAt).toBe("foreign"); expect(target?.updatedAt).toBe("foreign-sprint"); return { updates: [{ id: task.id, sprintId: sprint.id, scoreRelevant: true, updatedAt: "saved" }] }; } });
 const editor = planning.beginBacklogAssignment([task], [sprint], false); await planning.refreshWorkspace("backlog"); expect((await editor.assign(sprint.id)).phase).toBe("conflict"); expect(writes).toBe(0);
 omit = true; expect(await editor.refreshConflict()).toBe(false); omit = false; expect(await editor.refreshConflict()).toBe(true); expect((await editor.resave()).phase).toBe("saved"); expect(writes).toBe(1);
});
test.each([null,"new-account"])("session replacement cannot publish a late assignment (%s)", async replacement => {
 let session!: (id:string|null) => void; const write = deferred<{ updates: Partial<Task>[] }>();
 const { planning } = fixture({ subscribeSession: listener => { session = listener; return () => {}; }, assignBacklog: () => write.promise }); const editor = planning.beginBacklogAssignment([task],[sprint],false), saving = editor.assign(sprint.id); session(replacement); write.resolve({ updates: [{ id: task.id, sprintId: sprint.id, scoreRelevant: true, updatedAt: "late" }] }); expect((await saving).phase).toBe("ended"); expect(planning.backlogAssignments()).toEqual([]); expect(planning.backlog().model.items).toEqual([]);
});

test("dependent outcome checks stay unconfirmed and removal cannot bypass an unresolved assignment", async () => {
 let removals = 0, reads = 0;
 const { planning } = fixture({ assignBacklog: async () => { throw new Error("Unknown"); }, removeTask: async () => { removals++; return { affectedTaskIds: [task.id] }; }, readWorkspace: async () => { reads++; return { data: { ...emptyPlanningShellState, tasks: [task], sprints: [sprint] }, coverage: { tasks: "partial", sprints: "partial" } }; } });
 await planning.beginBacklogAssignment([task],[sprint],false).assign(sprint.id); expect((await planning.checkTaskSave(task.id)).outcome).toBe("unconfirmed"); const editor = planning.beginSprintEdit(sprint); await editor.save({ name: "Dependent" }); expect((await editor.checkOutcome()).outcome).toBe("unconfirmed"); expect(editor.view().phase).toBe("blocked"); expect((await planning.withdrawTask(task, "Reason")).ok).toBe(false); expect(removals).toBe(0); expect(reads).toBe(2);
});
test("denied Backlog read clears retained submissions and rejects a late successful write", async () => {
 const write = deferred<{ updates: Partial<Task>[] }>(); const { planning } = fixture({ assignBacklog: () => write.promise, readWorkspace: async () => { throw Object.assign(new Error("Denied"), { status: 403 }); } }); const editor = planning.beginBacklogAssignment([task],[sprint],false), saving = editor.assign(sprint.id); await planning.refreshWorkspace("backlog"); write.resolve({ updates: [{ id: task.id, sprintId: sprint.id, scoreRelevant: true, updatedAt: "late" }] }); expect((await saving).phase).toBe("ended"); expect(planning.backlogAssignments()).toEqual([]); expect(planning.backlog().model.items).toEqual([]); expect(planning.taskDetail(task.id).task?.updatedAt).toBe("r1");
});

test("single assignment preserves actual confirmed timeline effects independently of later reads", async () => {
 const activity = { id: 71, taskId: task.id, action: "task.updated", message: "Sprint changed", actorProfileId: "ceo", createdAt: "2026-10-28T00:00:00Z", beforeData: null, afterData: null };
 const { planning } = fixture({ assignBacklog: async () => ({ updates: [{ id: task.id, sprintId: sprint.id, scoreRelevant: true, updatedAt: "r2" }], activities: [activity] }) });
 await planning.beginBacklogAssignment([task],[sprint],false).assign(sprint.id); expect(planning.taskDetail(task.id).activities.map(item => item.id)).toContain(71);
});

test.each([["saved",1], ["unknown",1], ["rejected",0]] as const)("%s assignment rereads only an already loaded dependent Header slot (%i)", async (mode, expectedReads) => {
 let reads = 0; const header = { ...emptyPlanningHeaderData, notifications: readyHeaderSlot({ unreadCount: 0, items: [] }) };
 const { planning } = createPlanningState({ userId: "backlog-user", initialWorkspace: "backlog", initialData: { ...emptyPlanningShellState, tasks: [task], sprints: [sprint] }, initialHeaderData: header, adapter: { readWorkspace: async () => null, saveTask: async () => ({ task: {} }), assignBacklog: async () => { if (mode === "unknown") throw new Error("Lost response"); if (mode === "rejected") throw Object.assign(new Error("Rejected"), { status: 422 }); return { updates: [{ id: task.id, sprintId: sprint.id, scoreRelevant: true, updatedAt: "r2" }] }; }, readHeader: async slots => { expect(slots).toEqual(["notifications"]); reads++; return header; } } });
 await planning.beginBacklogAssignment([task],[sprint],false).assign(sprint.id); expect(reads).toBe(expectedReads); expect(planning.header().slots.calendarEvents.readStatus).toBe("not-loaded"); expect(planning.header().slots.quickLinks.readStatus).toBe("not-loaded");
});
