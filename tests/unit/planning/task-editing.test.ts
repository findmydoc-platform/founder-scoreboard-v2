import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { Task } from "@/lib/types";

const original = { id: "task-a", title: "Before", updatedAt: "opaque/r1", taskType: "deliverable" } as Task;
const initial = { ...emptyPlanningShellState, tasks: [original] };
function detail(task: Task) { return { revision: "detail", project: initial.project, item: task, ancestors: [], children: [], relatedItems: [], people: [], sprints: [], discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [] }; }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test("a draft keeps its original version after a foreign refresh and requires an explicit resave against reviewed server data", async () => {
  const versions: string[] = [];
  const foreign = { ...original, title: "Foreign", updatedAt: "opaque/r2" };
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    readWorkspace: async () => ({ data: { ...initial, tasks: [foreign] } }),
    readTaskDetail: async () => ({ model: detail(foreign) }),
    saveTask: async task => { versions.push(task.updatedAt || ""); return { task: { title: "My draft", updatedAt: "opaque/r3" } }; },
  } });
  const editor = planning.beginTaskEdit(original.id);
  await planning.refreshWorkspace("planning");
  await expect(editor.save({ title: "My draft" })).resolves.toMatchObject({ ok: false, kind: "versionConflict" });
  expect(editor.view()).toMatchObject({ phase: "conflict", submitted: { title: "My draft" }, serverTask: { title: "Foreign", updatedAt: "opaque/r2" }, canResave: true });
  expect(versions).toEqual([]);
  await expect(editor.resave({ title: "My draft" })).resolves.toMatchObject({ ok: true });
  expect(versions).toEqual(["opaque/r2"]);
  expect(planning.taskDetail(original.id).task).toMatchObject({ title: "My draft", updatedAt: "opaque/r3" });
});

test("rapid edits from one context stay visible and use only their own confirmed predecessor", async () => {
  const first = deferred<{ task: Partial<Task> }>();
  const second = deferred<{ task: Partial<Task> }>();
  const versions: string[] = [];
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    readWorkspace: async () => ({ data: initial }),
    saveTask: task => { versions.push(task.updatedAt || ""); return versions.length === 1 ? first.promise : second.promise; },
  } });
  const editor = planning.beginTaskEdit(original.id);
  const firstSave = editor.save({ title: "First draft" });
  const secondSave = editor.save({ title: "Second draft" });
  expect(planning.taskDetail(original.id).task?.title).toBe("Second draft");
  first.resolve({ task: { title: "First draft", updatedAt: "opaque/r2" } });
  await firstSave;
  expect(editor.view().phase).toBe("saving");
  expect(planning.taskDetail(original.id).task?.title).toBe("Second draft");
  second.resolve({ task: { title: "Second draft", updatedAt: "opaque/r3" } });
  await secondSave;
  expect(versions).toEqual(["opaque/r1", "opaque/r2"]);
  expect(editor.view().phase).toBe("saved");
  expect(planning.protectedCache()?.tasks[0]).toMatchObject({ title: "Second draft", updatedAt: "opaque/r3" });
});

test("a foreign revision between queued edits stays authoritative and pauses the dependent write", async () => {
  const first = deferred<{ task: Partial<Task> }>();
  const versions: string[] = [];
  const foreign = { ...original, title: "Foreign newer", updatedAt: "opaque/foreign" };
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    readWorkspace: async () => ({ data: { ...initial, tasks: [foreign] } }),
    readTaskDetail: async () => ({ model: detail(foreign) }),
    saveTask: task => { versions.push(task.updatedAt || ""); return first.promise; },
  } });
  const editor = planning.beginTaskEdit(original.id);
  const savedFirst = editor.save({ title: "First draft" });
  const savedSecond = editor.save({ title: "Second draft" });
  await planning.refreshWorkspace("planning");
  first.resolve({ task: { title: "First draft", updatedAt: "opaque/own" } });
  await savedFirst;
  await expect(savedSecond).resolves.toMatchObject({ ok: false, kind: "versionConflict" });
  expect(versions).toEqual(["opaque/r1"]);
  expect(planning.protectedCache()?.tasks[0]).toMatchObject({ title: "Foreign newer", updatedAt: "opaque/foreign" });
  expect(editor.view()).toMatchObject({ phase: "conflict", submitted: { title: "Second draft" }, serverTask: { updatedAt: "opaque/foreign" } });
});

test("another editor's confirmation cannot advance this editor's original write basis", async () => {
  const foreign = { ...original, title: "Other editor", updatedAt: "opaque/other-editor" };
  const versions: string[] = [];
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    readWorkspace: async () => ({ data: initial }), readTaskDetail: async () => ({ model: detail(foreign) }),
    saveTask: async task => { versions.push(task.updatedAt || ""); return { task: foreign }; },
  } });
  const first = planning.beginTaskEdit(original.id);
  const second = planning.beginTaskEdit(original.id);
  await first.save({ title: "Other editor" });
  await expect(second.save({ title: "Old input" })).resolves.toMatchObject({ ok: false, kind: "versionConflict" });
  expect(versions).toEqual(["opaque/r1"]);
  expect(second.view().submitted).toEqual({ title: "Old input" });
});

test("explicit resaving still rejects a further intervening revision and closing an editor retains submitted input", async () => {
  let server = { ...original, title: "Foreign", updatedAt: "opaque/r2" };
  const versions: string[] = [];
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    readWorkspace: async () => ({ data: { ...initial, tasks: [server] } }), readTaskDetail: async () => ({ model: detail(server) }),
    saveTask: async task => { versions.push(task.updatedAt || ""); throw Object.assign(new Error("Another version"), { status: 409, kind: "versionConflict" }); },
  } });
  const editor = planning.beginTaskEdit(original.id);
  await planning.refreshWorkspace("planning");
  await editor.save({ title: "Retained draft" });
  server = { ...server, updatedAt: "opaque/r3" };
  await planning.refreshWorkspace("planning");
  await expect(editor.resave({ title: "Retained draft" })).resolves.toMatchObject({ ok: false, kind: "versionConflict" });
  expect(versions).toEqual([]);
  editor.close();
  expect(planning.taskEdits(original.id)).toMatchObject([{ phase: "conflict", submitted: { title: "Retained draft" }, serverTask: { updatedAt: "opaque/r3" } }]);
});

test.each([["session_superseded", 409, "sessionSuperseded"], ["administrator_access_expired", 403, "authorityEnded"], ["state_conflict", 409, "rejected"]])("%s is not classified as a task version conflict", async (code, status, kind) => {
  let reads = 0;
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    readWorkspace: async () => ({ data: initial }), readTaskDetail: async () => { reads++; return { model: detail(original) }; },
    saveTask: async () => { throw Object.assign(new Error(code), { status, code }); },
  } });
  const editor = planning.beginTaskEdit(original.id);
  await expect(editor.save({ title: "Old input" })).resolves.toMatchObject({ ok: false, kind });
  expect(editor.view().canResave).toBe(false);
  expect(reads).toBe(0);
});

test("closing an editor leaves already submitted queued edits owned until their confirmations arrive", async () => {
  const first = deferred<{ task: Partial<Task> }>();
  const second = deferred<{ task: Partial<Task> }>();
  let writes = 0;
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    readWorkspace: async () => ({ data: initial }), saveTask: () => ++writes === 1 ? first.promise : second.promise,
  } });
  const editor = planning.beginTaskEdit(original.id);
  const firstSave = editor.save({ title: "First" });
  const secondSave = editor.save({ title: "Submitted second" });
  editor.close();
  expect(planning.taskEdits(original.id)[0]).toMatchObject({ phase: "saving", submitted: { title: "Submitted second" } });
  first.resolve({ task: { title: "First", updatedAt: "opaque/r2" } });
  await expect(firstSave).resolves.toMatchObject({ ok: true });
  second.resolve({ task: { title: "Submitted second", updatedAt: "opaque/r3" } });
  await expect(secondSave).resolves.toMatchObject({ ok: true });
  expect(planning.protectedCache()?.tasks[0]).toMatchObject({ title: "Submitted second", updatedAt: "opaque/r3" });
});

test("a released editor handle cannot expose submitted input or server data after its session ends", async () => {
  const write = deferred<{ task: Partial<Task> }>();
  let sessionChanged!: (userId: string | null) => void;
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    readWorkspace: async () => ({ data: initial }), saveTask: () => write.promise,
    subscribeSession: listener => { sessionChanged = listener; return () => {}; },
  } });
  const editor = planning.beginTaskEdit(original.id);
  const saved = editor.save({ title: "Protected input" });
  sessionChanged(null);
  expect(editor.view()).toMatchObject({ phase: "ended", submitted: null, serverTask: null, canResave: false });
  expect(planning.taskEdits(original.id)).toEqual([]);
  write.resolve({ task: { title: "Late", updatedAt: "opaque/late" } });
  await expect(saved).resolves.toMatchObject({ ok: false, kind: "sessionSuperseded" });
  expect(planning.protectedCache()).toBeNull();
});

test("a task snapshot shown by a caller cannot be rebased by opening its editor after a foreign read", async () => {
  const foreign = { ...original, title: "New server", updatedAt: "opaque/r2" };
  let writes = 0;
  const { planning } = createPlanningState({ userId: "user", initialData: initial, adapter: {
    readWorkspace: async () => ({ data: { ...initial, tasks: [foreign] } }), readTaskDetail: async () => ({ model: detail(foreign) }),
    saveTask: async () => { writes++; return { task: foreign }; },
  } });
  await planning.refreshWorkspace("planning");
  const editor = planning.beginTaskEdit(original);
  await expect(editor.save({ title: "Old shown input" })).resolves.toMatchObject({ ok: false, kind: "versionConflict" });
  expect(writes).toBe(0);
  expect(editor.view().submitted).toEqual({ title: "Old shown input" });
});
