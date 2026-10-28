import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { Sprint } from "@/lib/types";
const protectedSprint: Sprint = { id: "protected", name: "Sprint 1", status: "active", startDate: "2098-01-01", endDate: "2098-01-14", reviewDueAt: "protected-deadline", scoreLocked: true, updatedAt: "opaque/protected" };
const independent: Sprint = { ...protectedSprint, id: "independent", name: "Sprint 99", scoreLocked: false, updatedAt: "opaque/independent" };
const created: Sprint = { ...independent, id: "sprint-2", name: "Sprint 2", status: "planning", startDate: "2099-01-15", endDate: "2099-01-28", reviewDueAt: "server-deadline", updatedAt: "opaque/created" };
const initial = { ...emptyPlanningShellState, sprints: [protectedSprint, independent] };
const options = { firstSprintNumber: 1, anchorStartDate: "2099-01-01", rhythmWeeks: 2, horizonWeeks: 1, targetSprintNumber: 2 };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

test("a generated plan distinguishes provisional Sprints from confirmed changed-row membership and preserves protected plans", async () => {
  const receipt = deferred<{ sprints: Sprint[] }>();
  const read = deferred<{ data: typeof initial }>();
  const { planning } = createPlanningState({ userId: "user", initialWorkspace: "sprint", initialData: initial, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: () => read.promise, createSprintPlan: () => receipt.promise } });
  const editor = planning.beginSprintPlan();
  const save = editor.create(options);
  expect(planning.sprintPlan().provisionalSprintIds).toEqual(["sprint-2"]);
  expect(planning.sprintWorkspace().model.sprints.find(sprint => sprint.id === "sprint-2")).toMatchObject({ name: "Sprint 2", updatedAt: undefined });
  expect(planning.protectedCache()?.sprints).toHaveLength(2);
  receipt.resolve({ sprints: [created] });
  await expect(save).resolves.toMatchObject({ ok: true, changedCount: 1 });
  expect(planning.sprintPlan().provisionalSprintIds).toEqual([]);
  expect(planning.sprintWorkspace().model.sprints).toEqual([protectedSprint, independent, created]);
  expect(planning.protectedCache()?.sprints).toHaveLength(3);
});


test("an ambiguous Sprint plan keeps its submitted options and provisional rows while checks never repeat creation", async () => {
  let writes = 0, reads = 0;
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => { reads++; return { data: { ...initial, sprints: [...initial.sprints, created] } }; },
    createSprintPlan: async () => { writes++; throw new Error("Response lost"); },
  } });
  const editor = planning.beginSprintPlan();
  await expect(editor.create(options)).resolves.toMatchObject({ ok: false, kind: "unconfirmed" });
  editor.close();
  expect(planning.sprintPlan().edits[0]).toMatchObject({ phase: "unconfirmed", submitted: options });
  expect(planning.sprintPlan().provisionalSprintIds).toEqual(["sprint-2"]);
  await expect(planning.checkSprintPlan()).resolves.toMatchObject({ outcome: "unconfirmed" });
  await expect(planning.beginSprintPlan().create(options)).resolves.toMatchObject({ ok: false, kind: "unconfirmed" });
  expect({ writes, reads }).toEqual({ writes: 1, reads: 1 });
  expect(planning.sprintPlan().edits[0].phase).toBe("unconfirmed");
});


test("a retained plan compares a fresh server basis before a conscious recreate and never rebases on background reads", async () => {
  const bases: string[][] = [];
  const newer = { ...independent, updatedAt: "opaque/newer", name: "Sprint 99" };
  let server = initial;
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => ({ data: server }),
    createSprintPlan: async (_input, basis) => { bases.push(basis.sprints.map(row => row.updatedAt!)); if (bases.length === 1) throw Object.assign(new Error("Parallel changed"), { status: 409, code: "sprint_plan_conflict" }); return { sprints: [created] }; },
  } });
  const editor = planning.beginSprintPlan();
  server = { ...initial, sprints: [protectedSprint, newer] };
  await planning.refreshWorkspace("sprint");
  await expect(editor.create(options)).resolves.toMatchObject({ kind: "versionConflict" });
  expect(bases[0]).toEqual(["opaque/protected", "opaque/independent"]);
  await expect(editor.recreate(options)).resolves.toMatchObject({ ok: false });
  expect(bases).toHaveLength(1);
  expect(await editor.refreshConflict()).toBe(true);
  expect(editor.view()).toMatchObject({ phase: "conflict", submitted: options, canRecreate: true, serverSprints: [protectedSprint, newer] });
  await expect(editor.recreate(options)).resolves.toMatchObject({ ok: true });
  expect(bases[1]).toEqual(["opaque/protected", "opaque/newer"]);
});

test("known protected or credential conflicts remove only the plan overlay and remain distinct from revision conflicts", async () => {
  for (const code of ["sprint_locked", "session_superseded", "sprint_plan_conflict"]) {
    const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => ({ data: initial }), createSprintPlan: async () => { throw Object.assign(new Error(code), { status: 409, code }); } } });
    const editor = planning.beginSprintPlan();
    const result = await editor.create(options);
    expect(result).toMatchObject({ ok: false, kind: code === "session_superseded" ? "sessionSuperseded" : code === "sprint_plan_conflict" ? "versionConflict" : "rejected" });
    expect(planning.protectedCache()?.sprints).toEqual(initial.sprints);
    expect(planning.sprintPlan().provisionalSprintIds).toEqual(code === "session_superseded" ? ["sprint-2"] : []);
  }
});


test("an unconfirmed plan pauses dependent Sprint edits and deadline settings but permits independent records", async () => {
  const replanned = { ...created, updatedAt: "old/2", startDate: "2098-01-01" };
  let sprintWrites = 0, windowWrites = 0;
  const data = { ...initial, sprints: [...initial.sprints, replanned] };
  const { planning } = createPlanningState({ userId: "user", initialData: data, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => ({ data }), createSprintPlan: async () => { throw new Error("lost"); },
    saveSprint: async (basis, patch) => { sprintWrites++; return { sprint: { ...basis, ...patch, updatedAt: "saved" } }; },
    saveReviewWindow: async (_expected, hours) => { windowWrites++; return { project: { id: initial.project.id, reviewObjectionWindowHours: hours }, sprints: [] }; },
  } });
  await planning.beginSprintPlan().create(options);
  await expect(planning.beginSprintEdit(replanned).save({ name: "Dependent" })).resolves.toMatchObject({ ok: false, kind: "unconfirmed" });
  await expect(planning.beginReviewWindowEdit(initial.project.reviewObjectionWindowHours).save(72)).resolves.toMatchObject({ ok: false, kind: "unconfirmed" });
  await expect(planning.beginSprintEdit(independent).save({ name: "Independent" })).resolves.toMatchObject({ ok: true });
  expect({ sprintWrites, windowWrites }).toEqual({ sprintWrites: 1, windowWrites: 0 });
});


test("late plan receipts and older reads cannot replace later accepted Sprint data or resurrect a removed Sprint", async () => {
 const receipt=deferred<{sprints:Sprint[]}>(); const oldRead=deferred<{data:typeof initial}>();
 let reads=0; const newer={...created,updatedAt:"opaque/newest",name:"Accepted later"};
 const data={...initial,sprints:[...initial.sprints,created]};
 const owner=createPlanningState({userId:"user",initialData:data,adapter:{saveTask:async()=>({task:{}}),createSprintPlan:()=>receipt.promise,readWorkspace:()=>{reads++;return reads===1?oldRead.promise:Promise.resolve({data:{...initial,sprints:[protectedSprint,newer]},coverage:{sprints:"complete" as const}});}}});
 const old=owner.planning.refreshWorkspace("sprint"); const saving=owner.planning.beginSprintPlan().create(options);
 await owner.planning.refreshWorkspace("sprint"); receipt.resolve({sprints:[{...created,updatedAt:"opaque/old-receipt"},{...independent,updatedAt:"opaque/removed-receipt"}]}); await saving;
 oldRead.resolve({data}); await old;
 expect(owner.planning.protectedCache()?.sprints).toEqual([protectedSprint,newer]);
});

test("session invalidation discards a delayed plan receipt and submitted input",async()=>{
 const receipt=deferred<{sprints:Sprint[]}>();let reads=0;
 const owner=createPlanningState({userId:"user",initialData:initial,adapter:{saveTask:async()=>({task:{}}),createSprintPlan:()=>receipt.promise,readWorkspace:async()=>{reads++;return{data:initial};}}});
 const editor=owner.planning.beginSprintPlan();const saving=editor.create(options);owner.internal.endSession();receipt.resolve({sprints:[created]});await expect(saving).resolves.toMatchObject({kind:"sessionSuperseded"});expect(owner.planning.sprintPlan()).toEqual({provisionalSprintIds:[],edits:[]});expect(editor.view()).toMatchObject({phase:"ended",submitted:null});expect(reads).toBe(0);
});

test("a rejected plan removes only its provisional effects while an independent Sprint confirmation remains",async()=>{const receipt=deferred<{sprints:Sprint[]}>();const owner=createPlanningState({userId:"user",initialData:initial,adapter:{saveTask:async()=>({task:{}}),readWorkspace:async()=>({data:initial}),createSprintPlan:()=>receipt.promise,saveSprint:async(basis,patch)=>({sprint:{...basis,...patch,updatedAt:"opaque/independent-new"}})}});const save=owner.planning.beginSprintPlan().create(options);await owner.planning.beginSprintEdit(independent).save({status:"review"});receipt.reject(Object.assign(new Error("rejected"),{status:400}));await expect(save).resolves.toMatchObject({kind:"rejected"});expect(owner.planning.protectedCache()?.sprints).toEqual([protectedSprint,{...independent,status:"review",updatedAt:"opaque/independent-new"}]);expect(owner.planning.sprintPlan().provisionalSprintIds).toEqual([]);});
