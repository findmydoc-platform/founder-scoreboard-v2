import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { Task } from "@/lib/types";

const original = { id: "task-a", title: "Before", updatedAt: "opaque/r1", taskType: "deliverable" } as Task;
const initial = { ...emptyPlanningShellState, tasks: [original] };
function detail(task: Task) { return { revision: "detail", project: initial.project, item: task, ancestors: [], children: [], relatedItems: [], people: [], sprints: [], discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [] }; }

test("a lost task response retains input after release and matching server fields cannot confirm the operation or replay it", async () => {
  let writes = 0;
  let reads = 0;
  const matching = { ...original, title: "Submitted title", updatedAt: "opaque/r2" };
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    readWorkspace: async () => ({ data: initial }),
    readTaskDetail: async () => { reads++; return { model: detail(matching) }; },
    saveTask: async () => { writes++; throw new Error("Response lost"); },
  } });
  const editor = planning.beginTaskEdit(original);
  await expect(editor.save({ title: "Submitted title" })).resolves.toMatchObject({ ok: false, kind: "unconfirmed" });
  editor.close();
  expect(planning.taskSaves(original.id)).toMatchObject([{ phase: "unconfirmed", submitted: { title: "Submitted title" }, checkStatus: "not-checked" }]);
  expect(planning.protectedCache()?.tasks[0].title).toBe("Before");
  await expect(editor.checkOutcome()).resolves.toMatchObject({ outcome: "unconfirmed", readStatus: "current" });
  expect(planning.taskSaves(original.id)).toMatchObject([{ phase: "unconfirmed", submitted: { title: "Submitted title" }, checkStatus: "checked", serverTask: { title: "Submitted title" } }]);
  expect(planning.taskDetail(original.id).saveStatus).toBe("unconfirmed");
  expect(planning.protectedCache()?.tasks[0].updatedAt).toBe("opaque/r2");
  await expect(planning.beginTaskEdit(matching).save({ title: "Unsafe retry" })).resolves.toMatchObject({ ok: false, kind: "unconfirmed" });
  await expect(editor.resave({ title: "Unsafe retry" })).resolves.toMatchObject({ ok: false });
  expect({ writes, reads }).toEqual({ writes: 1, reads: 1 });
});


test("an unconfirmed predecessor pauses submitted dependent input while another task can save", async () => {
  let loseResponse!: (reason: Error) => void;
  const response = new Promise<{ task: Partial<Task> }>((_, reject) => { loseResponse = reject; });
  const other = { ...original, id: "task-b", title: "Independent" };
  const writes: string[] = [];
  const { planning } = createPlanningState({ userId: "user", initialData: { ...initial, tasks: [original, other] }, adapter: {
    readWorkspace: async () => ({ data: initial }),
    saveTask: async (task, patch) => {
      writes.push(task.id);
      return task.id === original.id ? response : { task: { ...patch, updatedAt: "opaque/other" } };
    },
  } });
  const editor = planning.beginTaskEdit(original);
  const first = editor.save({ title: "Dispatched first" });
  const second = editor.save({ title: "Submitted second" });
  editor.close();
  loseResponse(new Error("Response lost"));
  await expect(first).resolves.toMatchObject({ ok: false, kind: "unconfirmed" });
  await expect(second).resolves.toMatchObject({ ok: false, kind: "unconfirmed", code: "predecessor_unconfirmed" });
  expect(planning.taskSaves(original.id)).toMatchObject([
    { phase: "unconfirmed", submitted: { title: "Dispatched first" } },
    { phase: "blocked", submitted: { title: "Submitted second" } },
  ]);
  expect(planning.taskEdits(original.id)[0].phase).toBe("blocked");
  await expect(planning.beginTaskEdit(other).save({ title: "Saved independently" })).resolves.toMatchObject({ ok: true });
  expect(planning.taskDetail(other.id)).toMatchObject({ saveStatus: "saved", task: { title: "Saved independently" } });
  expect(planning.protectedCache()?.tasks.find(task => task.id === original.id)?.title).toBe("Before");
  expect(writes).toEqual(["task-a", "task-b"]);
});


test("a response discarded after a same-account credential change remains unconfirmed without becoming a revision conflict", async () => {
  let reads = 0;
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    readWorkspace: async () => ({ data: initial }),
    readTaskDetail: async () => { reads++; return { model: detail(original) }; },
    saveTask: async () => { throw Object.assign(new Error("Session snapshot replaced"), { status: 409, code: "session_superseded" }); },
  } });
  const editor = planning.beginTaskEdit(original);
  await expect(editor.save({ title: "Input sent with older credentials" })).resolves.toMatchObject({ ok: false, kind: "sessionSuperseded" });
  expect(editor.view()).toMatchObject({ phase: "unconfirmed", submitted: { title: "Input sent with older credentials" }, canResave: false });
  expect(planning.taskSaves(original.id)).toMatchObject([{ phase: "unconfirmed" }]);
  await expect(planning.checkTaskSave(original.id)).resolves.toMatchObject({ outcome: "unconfirmed" });
  expect(reads).toBe(1);
});


test.each([[403, "forbidden"], [503, "unavailable"]] as const)("failed outcome check %s retains uncertainty and never enables resaving", async (status, readStatus) => {
  let writes = 0;
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    readWorkspace: async () => ({ data: initial }),
    readTaskDetail: async () => { throw Object.assign(new Error("Cannot read"), { status }); },
    saveTask: async () => { writes++; throw new Error("Response lost"); },
  } });
  const editor = planning.beginTaskEdit(original);
  await editor.save({ title: "Protected submitted input" });
  await expect(planning.checkTaskSave(original.id)).resolves.toMatchObject({ outcome: "unconfirmed", readStatus });
  expect(planning.taskSaves(original.id)[0]).toMatchObject({ phase: "unconfirmed", checkStatus: readStatus, serverTask: null });
  expect(editor.view().canResave).toBe(false);
  if (readStatus === "forbidden") {
    expect(editor.view()).toMatchObject({ submitted: null, serverTask: null });
    expect(planning.taskSaves(original.id)[0].submitted).toBeNull();
  } else expect(editor.view().submitted).toEqual({ title: "Protected submitted input" });
  expect(writes).toBe(1);
});


test("concurrent checks share a read and a late check cannot restore retained protected input after logout", async () => {
  let completeRead!: (value: { model: ReturnType<typeof detail> }) => void;
  const read = new Promise<{ model: ReturnType<typeof detail> }>(resolve => { completeRead = resolve; });
  let sessionChanged!: (userId: string | null) => void;
  let reads = 0;
  let writes = 0;
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    readWorkspace: async () => ({ data: initial }),
    readTaskDetail: () => { reads++; return read; },
    saveTask: async () => { writes++; throw new Error("Response lost"); },
    subscribeSession: listener => { sessionChanged = listener; return () => {}; },
  } });
  const editor = planning.beginTaskEdit(original);
  await editor.save({ title: "Protected input" });
  editor.close();
  const firstCheck = editor.checkOutcome();
  const otherCheck = planning.checkTaskSave(original.id);
  expect(planning.taskSaves(original.id)[0].checkStatus).toBe("checking");
  sessionChanged(null);
  completeRead({ model: detail({ ...original, title: "Late server input", updatedAt: "opaque/late" }) });
  await expect(firstCheck).resolves.toMatchObject({ outcome: "session-ended" });
  await expect(otherCheck).resolves.toMatchObject({ outcome: "session-ended" });
  expect(planning.taskSaves(original.id)).toEqual([]);
  expect(planning.taskEdits(original.id)).toEqual([]);
  expect(editor.view()).toMatchObject({ submitted: null, serverTask: null, phase: "ended" });
  expect(planning.protectedCache()).toBeNull();
  expect({ writes, reads }).toEqual({ writes: 1, reads: 1 });
});


test("rechecking denied task access withholds retained fields until a new read authorizes them", async () => {
  let allowRead!: (value: { model: ReturnType<typeof detail> }) => void;
  const allowed = new Promise<{ model: ReturnType<typeof detail> }>(resolve => { allowRead = resolve; });
  let reads = 0;
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    readWorkspace: async () => ({ data: initial }),
    readTaskDetail: () => ++reads === 1 ? Promise.reject(Object.assign(new Error("Denied"), { status: 403 })) : allowed,
    saveTask: async () => { throw new Error("Response lost"); },
  } });
  const editor = planning.beginTaskEdit(original);
  await editor.save({ title: "Protected input" });
  await planning.checkTaskSave(original.id);
  const checking = planning.checkTaskSave(original.id);
  expect(planning.taskSaves(original.id)[0]).toMatchObject({ checkStatus: "checking", submitted: null, serverTask: null });
  expect(editor.view()).toMatchObject({ submitted: null, serverTask: null });
  allowRead({ model: detail(original) });
  await checking;
  expect(planning.taskSaves(original.id)[0].submitted).toEqual({ title: "Protected input" });
});
