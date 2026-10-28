import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { SprintLockReceipt } from "@/features/sprint/model/sprint-lock";
const sprint = { id: "sprint", name: "Sprint 1", status: "review" as const, startDate: "2020-01-01", endDate: "2020-01-14", reviewDueAt: "2020-01-16T22:59:59Z", scoreLocked: false, updatedAt: "opaque/shown" };
const task = taskDetailStoryTask({ id: "member", parentTaskId: "initiative", assigneeId: "founder", sprintId: sprint.id, updatedAt: "task/shown", scoreFinal: false });
const independent = taskDetailStoryTask({ id: "independent", parentTaskId: "initiative", assigneeId: "founder", sprintId: "other", updatedAt: "task/independent" });
const initial = { ...emptyPlanningShellState, sprints: [sprint], tasks: [task, independent] };
const options = { firstSprintNumber: 1, anchorStartDate: "2099-01-01", rhythmWeeks: 2, horizonWeeks: 1, targetSprintNumber: 2 };
const receipt: SprintLockReceipt = { sprint: { id: sprint.id, status: "closed", scoreLocked: true }, carryover: { nextSprintId: "next", created: 1, evaluated: 1 }, scoring: { scores: 2, strikeEvents: 2, governanceReviews: 0 } };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
test("a confirmed Sprint lock survives an unavailable projection read without rolling back independent work or claiming follow-up planning", async () => {
    const write = deferred<SprintLockReceipt>();
    let plans = 0;
    const owner = createPlanningState({ userId: "user", initialWorkspace: "sprint", initialData: initial, adapter: { saveTask: async (_task, patch) => ({ task: { ...patch, updatedAt: "task/confirmed" } }), readWorkspace: async () => { throw Object.assign(new Error("unavailable"), { status: 503 }); }, lockSprint: () => write.promise, createSprintPlan: async () => { plans++; return { sprints: [] }; } } });
    const editor = owner.planning.beginSprintLock(sprint, [task]);
    const save = editor.lock(options);
    expect(owner.planning.sprintWorkspace().model.sprints[0]).toMatchObject({ scoreLocked: true });
    expect(owner.planning.protectedCache()?.sprints[0].scoreLocked).toBe(false);
    await owner.planning.saveTask(independent, { title: "Independent accepted" });
    write.resolve(receipt);
    await expect(save).resolves.toMatchObject({ ok: true });
    expect(editor.view()).toMatchObject({ phase: "locked", receipt, projectionRead: "unavailable", followUp: { phase: "not-started" } });
    expect(owner.planning.protectedCache()?.sprints[0]).toMatchObject({ scoreLocked: true, status: "closed", updatedAt: undefined });
    expect(owner.planning.workspace("sprint").tasks.find(row => row.id === independent.id)?.title).toBe("Independent accepted");
    expect(plans).toBe(0);
});
test("unknown lock outcomes keep the original submitted workflow and check durable receipts read-only without preparing another plan", async () => { let writes = 0, plans = 0, checks = 0; let durable = false; const owner = createPlanningState({ userId: "user", initialData: initial, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => ({ data: initial }), lockSprint: async () => { writes++; throw new Error("lost"); }, readSprintLock: async () => { checks++; return { basis: { sprint: { ...sprint, status: "closed", scoreLocked: true, updatedAt: "opaque/locked" }, tasks: [task] }, tasksComplete: false, receipt: durable ? receipt : null }; }, createSprintPlan: async () => { plans++; return { sprints: [] }; } } }); const editor = owner.planning.beginSprintLock(sprint, [task]); await expect(editor.lock(options)).resolves.toMatchObject({ kind: "unconfirmed" }); editor.close(); await expect(editor.lock({ ...options, targetSprintNumber: 9 })).resolves.toMatchObject({ kind: "unconfirmed" }); expect(editor.view()).toMatchObject({ phase: "unconfirmed", submitted: options }); await expect(editor.checkOutcome()).resolves.toMatchObject({ outcome: "unconfirmed" }); durable = true; await expect(editor.checkOutcome()).resolves.toMatchObject({ outcome: "confirmed" }); expect(editor.view()).toMatchObject({ phase: "locked", receipt, followUp: { phase: "not-started" } }); expect({ writes, plans, checks }).toEqual({ writes: 1, plans: 0, checks: 2 }); });
test("a failed separate follow-up plan and an unlocked stale projection cannot undo a confirmed lock", async () => { const owner = createPlanningState({ userId: "user", initialData: initial, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => ({ data: initial }), lockSprint: async () => receipt, createSprintPlan: async () => { throw Object.assign(new Error("plan rejected"), { status: 400 }); } } }); const editor = owner.planning.beginSprintLock(sprint, [task]); await expect(editor.lock(options)).resolves.toMatchObject({ ok: true }); expect(editor.view()).toMatchObject({ phase: "locked", receipt, followUp: { phase: "failed", error: "plan rejected" } }); expect(owner.planning.protectedCache()?.sprints[0].scoreLocked).toBe(true); owner.internal.applyLegacyProjection(initial); expect(owner.planning.sprintWorkspace().model.sprints[0].scoreLocked).toBe(true); });
test("an unresolved lock pauses its actual dependent task and schedule while independent work remains available", async () => { let taskWrites = 0, sprintWrites = 0, planWrites = 0; const owner = createPlanningState({ userId: "user", initialData: initial, adapter: { saveTask: async (_task, patch) => { taskWrites++; return { task: { ...patch, updatedAt: "independent/next" } }; }, readWorkspace: async () => ({ data: initial }), lockSprint: async () => { throw new Error("lost"); }, saveSprint: async (basis, patch) => { sprintWrites++; return { sprint: { ...basis, ...patch, updatedAt: "new" } }; }, createSprintPlan: async () => { planWrites++; return { sprints: [] }; } } }); await owner.planning.beginSprintLock(sprint, [task]).lock(options); await expect(owner.planning.beginTaskEdit(task).save({ title: "Dependent" })).resolves.toMatchObject({ kind: "unconfirmed", code: "predecessor_unconfirmed" }); await expect(owner.planning.beginSprintEdit(sprint).save({ status: "active" })).resolves.toMatchObject({ kind: "unconfirmed" }); await expect(owner.planning.beginSprintPlan().create(options)).resolves.toMatchObject({ kind: "unconfirmed" }); await expect(owner.planning.saveTask(independent, { title: "Independent" })).resolves.toMatchObject({ ok: true }); expect({ taskWrites, sprintWrites, planWrites }).toEqual({ taskWrites: 1, sprintWrites: 0, planWrites: 0 }); });
test("a lock conflict retains the displayed basis until a fresh complete comparison and conscious lock", async () => { const bases: string[] = []; const serverTask = { ...task, title: "New server task", updatedAt: "task/new" }; const serverSprint = { ...sprint, updatedAt: "opaque/new" }; const owner = createPlanningState({ userId: "user", initialData: initial, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => ({ data: { ...initial, tasks: [serverTask, independent], sprints: [serverSprint] } }), lockSprint: async (basis) => { bases.push(basis.sprint.updatedAt! + ":" + basis.tasks[0].updatedAt); if (bases.length === 1)
            throw Object.assign(new Error("Task changed"), { status: 409, code: "sprint_lock_tasks_conflict" }); return receipt; }, readSprintLock: async () => ({ basis: { sprint: serverSprint, tasks: [serverTask] }, tasksComplete: true, receipt: null }), createSprintPlan: async () => ({ sprints: [] }) } }); const editor = owner.planning.beginSprintLock(sprint, [task]); await owner.planning.refreshWorkspace("sprint"); await expect(editor.lock(options)).resolves.toMatchObject({ kind: "versionConflict" }); expect(bases).toEqual(["opaque/shown:task/shown"]); await expect(editor.relock(options)).resolves.toMatchObject({ ok: false }); expect(await editor.refreshConflict()).toBe(true); expect(editor.view()).toMatchObject({ submitted: options, canRelock: true, serverBasis: { sprint: serverSprint, tasks: [serverTask] } }); await expect(editor.relock(options)).resolves.toMatchObject({ ok: true }); expect(bases).toEqual(["opaque/shown:task/shown", "opaque/new:task/new"]); });
test("a dependent task draft resumes after readonly lock proof but keeps its original task basis", async () => { let writes = 0; const finalized = { ...task, scoreFinal: true, scorePoints: 0, updatedAt: "task/final" }; const owner = createPlanningState({ userId: "user", initialData: initial, adapter: { saveTask: async () => { writes++; return { task: { updatedAt: "unexpected" } }; }, readWorkspace: async () => ({ data: { ...initial, tasks: [finalized, independent], sprints: [{ ...sprint, status: "closed", scoreLocked: true, updatedAt: "locked" }] } }), lockSprint: async () => { throw new Error("lost"); }, readSprintLock: async () => ({ basis: { sprint: { ...sprint, status: "closed", scoreLocked: true, updatedAt: "locked" }, tasks: [] }, tasksComplete: false, receipt }) } }); await owner.planning.beginSprintLock(sprint, [task]).lock(options); const draft = owner.planning.beginTaskEdit(task); await draft.save({ title: "Retained" }); expect(draft.view().phase).toBe("blocked"); await expect(draft.checkOutcome()).resolves.toMatchObject({ outcome: "not-pending" }); expect(draft.view()).toMatchObject({ phase: "editing", submitted: { title: "Retained" } }); await expect(draft.save({ title: "Retained" })).resolves.toMatchObject({ kind: "versionConflict" }); expect(writes).toBe(0); });
test("withdrawal of a task in an unresolved lock retains its submitted reason without removing or writing the task", async () => { let removals = 0; const owner = createPlanningState({ userId: "user", initialData: initial, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => ({ data: initial }), lockSprint: async () => { throw new Error("lost"); }, removeTask: async () => { removals++; return { affectedTaskIds: [task.id] }; } } }); await owner.planning.beginSprintLock(sprint, [task]).lock(options); await expect(owner.planning.withdrawTask(task, "Retained reason")).resolves.toMatchObject({ kind: "unconfirmed" }); expect(removals).toBe(0); expect(owner.planning.taskLifecycle().at(-1)).toMatchObject({ phase: "blocked", submitted: { reason: "Retained reason" } }); expect(owner.planning.board().tasks.some(row => row.id === task.id)).toBe(true); });
test("a delayed lock result cannot attach to a replacement session or start follow-up planning", async () => { const write = deferred<SprintLockReceipt>(); let reads = 0, plans = 0; const owner = createPlanningState({ userId: "user", initialData: initial, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => { reads++; return { data: initial }; }, lockSprint: () => write.promise, createSprintPlan: async () => { plans++; return { sprints: [] }; } } }); const editor = owner.planning.beginSprintLock(sprint, [task]); const result = editor.lock(options); owner.internal.endSession(); write.resolve(receipt); await expect(result).resolves.toMatchObject({ kind: "sessionSuperseded" }); expect(owner.planning.sprintLocks(sprint.id)).toEqual([]); expect(editor.view()).toMatchObject({ phase: "ended", submitted: null, receipt: null }); expect({ reads, plans }).toEqual({ reads: 0, plans: 0 }); });
test("a conflict comparison can accept an existing durable lock receipt without another lock or plan write", async () => { let writes = 0, plans = 0; const locked = { ...sprint, status: "closed" as const, scoreLocked: true, updatedAt: "opaque/locked" }; const owner = createPlanningState({ userId: "user", initialData: initial, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => ({ data: { ...initial, sprints: [locked] } }), lockSprint: async () => { writes++; throw Object.assign(new Error("Changed"), { status: 409, code: "sprint_lock_conflict" }); }, readSprintLock: async () => ({ basis: { sprint: locked, tasks: [] }, tasksComplete: false, receipt }), createSprintPlan: async () => { plans++; return { sprints: [] }; } } }); const editor = owner.planning.beginSprintLock(sprint, [task]); await editor.lock(options); await editor.refreshConflict(); expect(editor.view()).toMatchObject({ phase: "locked", receipt, canRelock: false, followUp: { phase: "not-started" } }); expect({ writes, plans }).toEqual({ writes: 1, plans: 0 }); });
test("loaded Planning membership is reread for actual carry-over identities after a confirmed lock", async () => {
    const reads: string[] = [];
    let locked = false;
    const carryover = { ...task, id: "actual-carryover", sprintId: "no-sprint", approvalState: "proposed" as const, updatedAt: "actual-created" };
    const owner = createPlanningState({ userId: "user", initialWorkspace: "planning", initialData: initial, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async (workspace) => { reads.push(workspace); return { data: locked ? { ...initial, tasks: [{ ...task, scoreFinal: true, updatedAt: "finalized" }, independent, carryover], sprints: [{ ...sprint, status: "closed", scoreLocked: true, updatedAt: "locked" }] } : initial }; }, lockSprint: async () => { locked = true; return receipt; }, createSprintPlan: async () => ({ sprints: [] }) } });
    await owner.planning.beginSprintLock(sprint, [task]).lock(options);
    expect(owner.planning.workspace("planning").tasks.map(row => row.id)).toContain("actual-carryover");
    expect(owner.planning.workspace("planning").readStatus).toBe("current");
    expect(reads).toEqual(["sprint", "planning", "sprint"]);
});
test("old reads and legacy rollback preserve confirmed lock scores and independent attendance", async () => {
    const old = deferred<{
        data: typeof initial;
    }>();
    let reads = 0;
    const score = { id: 1, sprintId: sprint.id, profileId: "founder", deliveryPoints: 4, formPoints: 1, weeklyPoints: 1, totalPoints: 6, fulfilled: true, awayNeutral: false, finalizedAt: "confirmed", finalizedBy: "ceo", reasonSummary: "Actual score" };
    const strike = { id: 1, profileId: "founder", strikeLevel: 1, fulfilledResetStreak: 0, lastEvaluatedSprintId: sprint.id, updatedAt: "confirmed" };
    const event = { id: 1, profileId: "founder", sprintId: sprint.id, eventType: "strike_added" as const, previousStrikeLevel: 0, nextStrikeLevel: 1, reason: "Actual event", createdAt: "confirmed", createdBy: "ceo" };
    const attendance = { id: 1, meetingId: 1, profileId: "other", status: "present" as const, absenceReason: "", reasonAccepted: false, writtenUpdate: "Independent attendance", points: 1, createdAt: "before", updatedAt: "after" };
    const owner = createPlanningState({ userId: "user", initialWorkspace: "sprint", initialData: initial, adapter: { saveMeetingAttendance: async () => ({ attendance, effects: "confirmed" }), saveTask: async () => ({ task: {} }), readWorkspace: async () => ++reads === 1 ? old.promise : { data: { ...initial, sprints: [{ ...sprint, status: "closed", scoreLocked: true, updatedAt: "locked" }], founderSprintScores: [score], founderStrikeStates: [strike], strikeEvents: [event] } }, lockSprint: async () => receipt, createSprintPlan: async () => ({ sprints: [] }) } });
    const delayed = owner.planning.refreshWorkspace("sprint");
    await owner.planning.beginSprintLock(sprint, [task]).lock(options);
    old.resolve({ data: initial });
    await delayed;
    await owner.planning.beginMeetingAttendance({ id: 1, sprintId: "other", title: "Independent Weekly", meetingAt: "2026-10-28T09:00:00Z", status: "planned", agenda: "" }, attendance.profileId, { ...attendance, writtenUpdate: "", updatedAt: "before" }).save({ writtenUpdate: attendance.writtenUpdate });
    owner.internal.applyLegacyProjection(initial);
    const model = owner.planning.sprintWorkspace().model;
    expect(model.scores).toEqual([score]);
    expect(model.strikeStates).toEqual([strike]);
    expect(model.strikeEvents).toEqual([event]);
    expect(model.attendance).toEqual([attendance]);
    expect(model.sprints[0].scoreLocked).toBe(true);
});


test("unknown Backlog assignment pauses only its dependent lock while an independent Sprint can close", async () => {
 let locks=0;
 const otherSprint={...sprint,id:"independent-sprint"};
 const owner=createPlanningState({userId:"user",initialWorkspace:"backlog",initialData:{...initial,sprints:[sprint,otherSprint]},adapter:{saveTask:async()=>({task:{}}),readWorkspace:async()=>null,assignBacklog:async()=>{throw new Error("Unknown assignment");},lockSprint:async basis=>{locks++;return {...receipt,sprint:{...receipt.sprint,id:basis.sprint.id}};}}});
 await owner.planning.beginBacklogAssignment([task],[sprint],false).assign(sprint.id);
 const dependent=owner.planning.beginSprintLock(sprint,[task]);
 await expect(dependent.lock(options)).resolves.toMatchObject({kind:"unconfirmed"});
 expect(dependent.view().phase).toBe("blocked");
 await expect(owner.planning.beginSprintLock(otherSprint,[]).lock(options)).resolves.toMatchObject({ok:true});
 expect(locks).toBe(1);
});

test("an unknown lock pauses Backlog admission to its Sprint without blocking assignment to an independent Sprint",async()=>{
 let assignments=0;
 const otherSprint={...sprint,id:"independent-sprint"};const unassigned={...independent,sprintId:""};
 const owner=createPlanningState({userId:"user",initialWorkspace:"backlog",initialData:{...initial,tasks:[task,unassigned],sprints:[sprint,otherSprint]},adapter:{saveTask:async()=>({task:{}}),readWorkspace:async()=>null,lockSprint:async()=>{throw new Error("Unknown lock");},assignBacklog:async(tasks,target)=>{assignments++;return{updates:tasks.map(task=>({id:task.id,sprintId:target?.id||"",scoreRelevant:true,updatedAt:"confirmed"}))};}}});
 await owner.planning.beginSprintLock(sprint,[task]).lock(options);
 const dependent=owner.planning.beginBacklogAssignment([unassigned],[sprint,otherSprint],false);
 expect(await dependent.assign(sprint.id)).toMatchObject({phase:"blocked"});
 expect(await owner.planning.beginBacklogAssignment([unassigned],[sprint,otherSprint],false).assign(otherSprint.id)).toMatchObject({phase:"saved"});
 expect(assignments).toBe(1);
});

test.each([["sprint_lock_objections","rejected"],["sprint_lock_window","rejected"],["session_superseded","unconfirmed"]] as const)("409 %s keeps its actual taxonomy and never removes independent confirmation",async(code,phase)=>{
 const write=deferred<SprintLockReceipt>();
 const owner=createPlanningState({userId:"user",initialWorkspace:"sprint",initialData:initial,adapter:{saveTask:async(_task,patch)=>({task:{...patch,updatedAt:"independent/confirmed"}}),readWorkspace:async()=>null,lockSprint:()=>write.promise}});
 const editor=owner.planning.beginSprintLock(sprint,[task]),saving=editor.lock(options);
 await owner.planning.saveTask(independent,{title:"Independent confirmation"});
 write.reject(Object.assign(new Error("Policy changed"),{status:409,code}));await saving;
 expect(editor.view().phase).toBe(phase);
 expect(owner.planning.taskDetail(independent.id).task?.title).toBe("Independent confirmation");
 expect(owner.planning.protectedCache()?.sprints[0].scoreLocked).toBe(false);
 expect(owner.planning.sprintWorkspace().model.sprints[0].scoreLocked).toBe(phase==="unconfirmed");
});
