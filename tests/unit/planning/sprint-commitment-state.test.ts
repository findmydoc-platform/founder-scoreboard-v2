import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { PlanningShellState, SprintCommitment } from "@/lib/types";
const commitment: SprintCommitment = { id: 1, sprintId: "sprint", profileId: "founder", commitmentLevel: "Standard", weeklyHours: 20, note: "Shown", updatedAt: "opaque/shown" };
const sprint = { id: "sprint", name: "Shown Sprint", status: "active" as const, startDate: "2026-10-01", endDate: "2026-10-14", reviewDueAt: "", scoreLocked: false, updatedAt: "sprint/shown" };
const initial = { ...emptyPlanningShellState, sprints: [sprint], sprintCommitments: [commitment] };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
test("a commitment confirmation changes its Sprint/profile identity while pending effects and legacy rollback cannot replace confirmed work", async () => {
  const write = deferred<{ commitment: SprintCommitment ;}>(); const old = deferred<{ data: typeof initial ;}>();
  let cached: PlanningShellState = initial;
  const owner = createPlanningState({ userId: "user", initialWorkspace: "sprint", initialData: initial, publishCache: data => { if (data) cached = data; }, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: () => old.promise, saveSprintCommitment: () => write.promise } });
  const read = owner.planning.refreshWorkspace("sprint");
  const editor = owner.planning.beginSprintCommitmentEdit(commitment);
  const save = editor.save({ weeklyHours: 30 });
  expect(owner.planning.sprintWorkspace().model.commitments[0].weeklyHours).toBe(30);
  expect(cached.sprintCommitments[0].weeklyHours).toBe(20);
  write.resolve({ commitment: { ...commitment, weeklyHours: 30, updatedAt: "opaque/saved" } });
  await expect(save).resolves.toMatchObject({ ok: true });
  old.resolve({ data: initial }); await read;
  owner.internal.applyLegacyProjection(initial);
  expect(owner.planning.sprintWorkspace().model.commitments).toEqual([{ ...commitment, weeklyHours: 30, updatedAt: "opaque/saved" }]);
  expect(cached.sprintCommitments[0].weeklyHours).toBe(30);
  expect(owner.planning.sprintWorkspace().readStatus).toBe("stale");
});

test("unknown commitment outcome retains input across navigation and checks read-only while other profiles remain usable", async () => {
  let writes = 0, reads = 0;
  const { planning } = createPlanningState({ userId: "user", initialWorkspace: "sprint", initialData: initial, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => { reads++; return { data: { ...initial, sprintCommitments: [{ ...commitment, weeklyHours: 30, updatedAt: "opaque/matching" }] }, coverage: { sprintCommitments: "complete" } }; }, saveSprintCommitment: async (basis, patch) => { writes++; if (basis.profileId === "founder") throw new Error("Lost response"); return { commitment: { ...basis, ...patch, id: 2, updatedAt: "opaque/other" } }; } } });
  const editor = planning.beginSprintCommitmentEdit(commitment);
  await expect(editor.save({ weeklyHours: 30 })).resolves.toMatchObject({ ok: false, kind: "unconfirmed" }); editor.close();
  expect(planning.sprintCommitmentEdits("sprint", "founder")[0]).toMatchObject({ phase: "unconfirmed", submitted: { weeklyHours: 30 } });
  await expect(planning.beginSprintCommitmentEdit(commitment).save({ weeklyHours: 40 })).resolves.toMatchObject({ ok: false, kind: "unconfirmed" });
  await expect(planning.beginSprintCommitmentEdit({ ...commitment, id: 0, profileId: "other", updatedAt: undefined }).save({ weeklyHours: 10 })).resolves.toMatchObject({ ok: true });
  await expect(editor.checkOutcome()).resolves.toMatchObject({ outcome: "unconfirmed" });
  expect({ writes, reads }).toEqual({ writes: 2, reads: 1 }); expect(editor.view().phase).toBe("unconfirmed");
});

test("a commitment draft keeps the shown basis through background reads and consciously adopts only a freshly returned comparison", async () => {
  const foreign = { ...commitment, weeklyHours: 16, updatedAt: "opaque/foreign" }; const bases: (string | undefined)[] = [];
  const { planning } = createPlanningState({ userId: "user", initialWorkspace: "sprint", initialData: initial, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => ({ data: { ...initial, sprintCommitments: [foreign] }, coverage: { sprintCommitments: "complete" } }), saveSprintCommitment: async (basis, patch) => { bases.push(basis.updatedAt); return { commitment: { ...basis, ...patch, updatedAt: "opaque/resaved" } }; } } });
  const editor = planning.beginSprintCommitmentEdit(commitment); await planning.refreshWorkspace("sprint");
  await expect(editor.save({ weeklyHours: 30 })).resolves.toMatchObject({ ok: false, kind: "versionConflict" }); expect(bases).toEqual([]);
  expect(editor.view()).toMatchObject({ phase: "conflict", submitted: { weeklyHours: 30 }, canResave: false });
  await expect(editor.refreshConflict()).resolves.toBe(true); expect(editor.view().serverCommitment).toEqual(foreign);
  await expect(editor.resave({ weeklyHours: 30 })).resolves.toMatchObject({ ok: true }); expect(bases).toEqual(["opaque/foreign"]);
});

test("only a commitment editor's own confirmed predecessor advances rapid queued changes", async () => {
  const first = deferred<{ commitment: SprintCommitment ;}>(); const bases: (string | undefined)[] = [];
  const { planning } = createPlanningState({ userId: "user", initialWorkspace: "sprint", initialData: initial, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => ({ data: initial }), saveSprintCommitment: async (basis, patch) => { bases.push(basis.updatedAt); return bases.length === 1 ? first.promise : { commitment: { ...basis, ...patch, updatedAt: "opaque/second" } }; } } });
  const own = planning.beginSprintCommitmentEdit(commitment), foreign = planning.beginSprintCommitmentEdit(commitment);
  const one = own.save({ commitmentLevel: "Heavy" }), two = own.save({ weeklyHours: 32 });
  expect(bases).toEqual(["opaque/shown"]); first.resolve({ commitment: { ...commitment, commitmentLevel: "Heavy", updatedAt: "opaque/first" } });
  await one; await expect(two).resolves.toMatchObject({ ok: true }); expect(bases).toEqual(["opaque/shown", "opaque/first"]);
  expect(planning.sprintWorkspace().model.commitments[0]).toMatchObject({ commitmentLevel: "Heavy", weeklyHours: 32 });
  await expect(foreign.save({ note: "Foreign draft" })).resolves.toMatchObject({ ok: false, kind: "versionConflict" });
});

test.each(["logout", "replacement"])("a late commitment result after %s cannot restore protected input or business records", async change => {
  const response = deferred<{ commitment: SprintCommitment ;}>(); const owner = createPlanningState({ userId: "user", initialData: initial, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => ({ data: initial }), saveSprintCommitment: () => response.promise } });
  const editor = owner.planning.beginSprintCommitmentEdit(commitment); const save = editor.save({ note: "Private input" }); editor.close();
  if (change === "logout") owner.internal.endSession(); else owner.internal.sessionChanged("other-user");
  response.resolve({ commitment: { ...commitment, note: "Private input", updatedAt: "opaque/late" } });
  await expect(save).resolves.toMatchObject({ ok: false, kind: "sessionSuperseded" }); expect(editor.view()).toMatchObject({ phase: "ended", submitted: null, serverCommitment: null }); expect(owner.planning.sprintWorkspace().model.commitments).toEqual([]);
});

test("an invalid or foreign commitment receipt stays unconfirmed and cannot replace the target", async () => {
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => ({ data: initial }), saveSprintCommitment: async () => ({ commitment: { ...commitment, profileId: "foreign", updatedAt: "opaque/foreign" } }) } });
  await expect(planning.beginSprintCommitmentEdit(commitment).save({ note: "Kept" })).resolves.toMatchObject({ ok: false, kind: "unconfirmed" });
  expect(planning.sprintWorkspace().model.commitments).not.toContainEqual(expect.objectContaining({ profileId: "foreign" }));
});

test("known rejection isolates its overlay from independent Sprint, task and other-person confirmations", async () => {
  const failure = deferred<{ commitment: SprintCommitment ;}>(); const other = { ...commitment, id: 2, profileId: "other", updatedAt: "other/shown" };
  const data = { ...initial, sprintCommitments: [commitment, other] };
  const { planning } = createPlanningState({ userId: "user", initialData: data, adapter: { saveTask: async () => ({ task: {} }), saveSprint: async (basis, patch) => ({ sprint: { ...basis, ...patch, updatedAt: "sprint/confirmed" } }), readWorkspace: async () => ({ data }), saveSprintCommitment: async (basis, patch) => basis.profileId === "founder" ? failure.promise : { commitment: { ...basis, ...patch, updatedAt: "other/confirmed" } } } });
  const rejected = planning.beginSprintCommitmentEdit(commitment).save({ weeklyHours: 40 });
  await planning.beginSprintCommitmentEdit(other).save({ weeklyHours: 12 }); await planning.beginSprintEdit(sprint).save({ name: "Independent Sprint" });
  failure.reject(Object.assign(new Error("Known validation rejection"), { status: 422 })); await expect(rejected).resolves.toMatchObject({ ok: false, kind: "rejected" });
  expect(planning.sprintWorkspace().model.commitments).toEqual(expect.arrayContaining([commitment, { ...other, weeklyHours: 12, updatedAt: "other/confirmed" }])); expect(planning.sprintWorkspace().model.sprints[0].name).toBe("Independent Sprint");
});
test("a partial read neither deletes another commitment nor enables conflict comparison from a cached target", async () => {
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => ({ data: { ...initial, sprintCommitments: [] }, coverage: { sprintCommitments: "partial" } }), saveSprintCommitment: async () => { throw Object.assign(new Error("Changed"), { status: 409, code: "commitment_revision_conflict" }); } } });
  const editor = planning.beginSprintCommitmentEdit(commitment); await editor.save({ note: "Retained" }); await expect(editor.refreshConflict()).resolves.toBe(false); expect(editor.view().canResave).toBe(false); expect(planning.sprintWorkspace().model.commitments).toEqual([commitment]);
});
test("a submitted commitment patch is copied before waiting for its predecessor", async () => {
  const first = deferred<{ commitment: SprintCommitment ;}>(); let calls = 0; const notes: string[] = [];
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => ({ data: initial }), saveSprintCommitment: async (basis, patch) => { calls++; notes.push(patch.note || ""); return calls === 1 ? first.promise : { commitment: { ...basis, ...patch, updatedAt: "opaque/copied" } }; } } });
  const editor = planning.beginSprintCommitmentEdit(commitment); const one = editor.save({ weeklyHours: 12 }); const patch = { note: "Submitted" }; const two = editor.save(patch); patch.note = "Changed after submit"; first.resolve({ commitment: { ...commitment, weeklyHours: 12, updatedAt: "opaque/first" } }); await one; await two; expect(notes).toEqual(["", "Submitted"]);
});

test("an older partial cross-workspace read cannot undo a newer accepted commitment read", async () => {
  const older = deferred<{ data: typeof initial; coverage: { sprintCommitments: "partial" ;} ;}>();
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: workspace => workspace === "backlog" ? older.promise : Promise.resolve({ data: { ...initial, sprintCommitments: [{ ...commitment, weeklyHours: 32, updatedAt: "opaque/newer" }] }, coverage: { sprintCommitments: "partial" } }) } });
  const read = planning.refreshWorkspace("backlog"); await planning.refreshWorkspace("sprint"); older.resolve({ data: initial, coverage: { sprintCommitments: "partial" } }); await read;
  expect(planning.sprintWorkspace().model.commitments[0]).toMatchObject({ weeklyHours: 32, updatedAt: "opaque/newer" });
});

test("coalesced unknown checks expose the actual returned comparison without proving all write effects", async () => {
  const read = deferred<{ data: typeof initial; coverage: { sprintCommitments: "complete" ;} ;}>(); let reads = 0;
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: () => { reads++; return read.promise; }, saveSprintCommitment: async () => { throw new Error("Lost"); } } });
  const editor = planning.beginSprintCommitmentEdit(commitment); await editor.save({ weeklyHours: 30 }); const one = editor.checkOutcome(), two = editor.checkOutcome(); expect(reads).toBe(1);
  read.resolve({ data: { ...initial, sprintCommitments: [{ ...commitment, weeklyHours: 30, updatedAt: "opaque/check" }] }, coverage: { sprintCommitments: "complete" } }); await one; await two;
  expect(editor.view()).toMatchObject({ phase: "unconfirmed", serverCommitment: { weeklyHours: 30, updatedAt: "opaque/check" }, checkStatus: "checked" });
});

test("an unresolved commitment makes dependent scoring coverage partial and pauses only its Sprint lock", async () => {
  let locks = 0; const { planning } = createPlanningState({ userId: "user", initialWorkspace: "sprint", initialData: initial, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => ({ data: initial, coverage: { sprintCommitments: "complete", sprints: "complete", tasks: "complete" } }), saveSprintCommitment: async () => { throw new Error("Lost"); }, lockSprint: async () => { locks++; throw new Error("Unexpected lock dispatch"); } } });
  await planning.refreshWorkspace("sprint"); expect(planning.sprintWorkspace().model.coverage.commitments).toBe("complete");
  await planning.beginSprintCommitmentEdit(commitment).save({ weeklyHours: 30 }); expect(planning.sprintWorkspace().model.coverage.commitments).toBe("partial");
  await planning.beginSprintLock(sprint, []).lock({ firstSprintNumber: 1, anchorStartDate: "2026-10-01", rhythmWeeks: 2, horizonWeeks: 1, targetSprintNumber: 2 }); expect(locks).toBe(0);
});

test("a delayed commitment confirmation cannot replace a later authoritative foreign version", async () => {
  const write = deferred<{ commitment: SprintCommitment ;}>(); const foreign = { ...commitment, weeklyHours: 12, updatedAt: "opaque/later" };
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => ({ data: { ...initial, sprintCommitments: [foreign] }, coverage: { sprintCommitments: "complete" } }), saveSprintCommitment: () => write.promise } });
  const editor = planning.beginSprintCommitmentEdit(commitment); const save = editor.save({ weeklyHours: 30 }); await planning.refreshWorkspace("sprint"); write.resolve({ commitment: { ...commitment, weeklyHours: 30, updatedAt: "opaque/earlier" } }); await save;
  expect(planning.sprintWorkspace().model.commitments).toEqual([foreign]);
});

test("an actual commitment row confirmation survives separate audit failure and reports the incomplete follow-up",async()=>{
 const {planning}=createPlanningState({userId:"user",initialData:initial,adapter:{saveTask:async()=>({task:{}}),readWorkspace:async()=>({data:initial}),saveSprintCommitment:async(basis,patch)=>({commitment:{...basis,...patch,updatedAt:"opaque/saved"},auditError:"Commitment saved; audit unavailable"})}});
 const editor=planning.beginSprintCommitmentEdit(commitment);await expect(editor.save({weeklyHours:28})).resolves.toMatchObject({ok:true,auditError:"Commitment saved; audit unavailable"});
 expect(editor.view()).toMatchObject({phase:"saved",error:"Commitment saved; audit unavailable"});expect(planning.sprintWorkspace().model.commitments[0].weeklyHours).toBe(28);
});

test("an unresolved Sprint lock pauses commitment writes to its scoring input without pausing other Sprints",async()=>{
 let writes=0;const second={...sprint,id:"other-sprint"};const {planning}=createPlanningState({userId:"user",initialWorkspace:"sprint",initialData:{...initial,sprints:[sprint,second]},adapter:{saveTask:async()=>({task:{}}),readWorkspace:async()=>({data:initial}),lockSprint:async()=>{throw new Error("Lock response lost");},saveSprintCommitment:async(basis,patch)=>{writes++;return {commitment:{...basis,...patch,id:basis.id||2,updatedAt:"opaque/saved"}};}}});
 await planning.beginSprintLock(sprint,[]).lock({firstSprintNumber:1,anchorStartDate:"2026-10-01",rhythmWeeks:2,horizonWeeks:1,targetSprintNumber:2});
 await expect(planning.beginSprintCommitmentEdit(commitment).save({weeklyHours:24})).resolves.toMatchObject({ok:false,kind:"unconfirmed"});expect(writes).toBe(0);
 await expect(planning.beginSprintCommitmentEdit({...commitment,sprintId:second.id,id:0,updatedAt:undefined}).save({weeklyHours:12})).resolves.toMatchObject({ok:true});expect(writes).toBe(1);
});

test("a retained genuine commitment conflict pauses other editors of that pair until conscious resave",async()=>{
 let writes=0;const foreign={...commitment,updatedAt:"opaque/foreign"};const {planning}=createPlanningState({userId:"user",initialData:initial,adapter:{saveTask:async()=>({task:{}}),readWorkspace:async()=>({data:{...initial,sprintCommitments:[foreign]},coverage:{sprintCommitments:"complete"}}),saveSprintCommitment:async(basis,patch)=>{writes++;if(writes===1)throw Object.assign(new Error("Changed"),{status:409,code:"commitment_revision_conflict"});return {commitment:{...basis,...patch,updatedAt:"opaque/resaved"}};}}});
 const editor=planning.beginSprintCommitmentEdit(commitment);await editor.save({weeklyHours:24});await planning.refreshWorkspace("sprint");
 await expect(planning.beginSprintCommitmentEdit(foreign).save({weeklyHours:16})).resolves.toMatchObject({ok:false,kind:"unconfirmed"});expect(writes).toBe(1);
 await editor.refreshConflict();await expect(editor.resave({weeklyHours:24})).resolves.toMatchObject({ok:true});expect(writes).toBe(2);expect(planning.sprintCommitmentEdits("sprint","founder").some(view=>view.phase==="blocked")).toBe(false);
});

test("an existing commitment without its displayed version cannot acquire a save-time basis",async()=>{
 let writes=0;const {planning}=createPlanningState({userId:"user",initialData:initial,adapter:{saveTask:async()=>({task:{}}),readWorkspace:async()=>({data:initial}),saveSprintCommitment:async(basis,patch)=>{writes++;return {commitment:{...basis,...patch,updatedAt:"opaque/saved"}};}}});
 const shown={...commitment,updatedAt:undefined};await expect(planning.beginSprintCommitmentEdit(shown).save({weeklyHours:32})).resolves.toMatchObject({ok:false,kind:"rejected"});expect(writes).toBe(0);
});
