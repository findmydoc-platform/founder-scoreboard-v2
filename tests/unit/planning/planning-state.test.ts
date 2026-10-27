import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { Task } from "@/lib/types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const original = { id: "task-a", title: "Before", updatedAt: "r1", taskType: "deliverable" } as Task;
const initial = { ...emptyPlanningShellState, tasks: [original] };

test("ordinary task edits remain pending until the confirmed revision reaches the Board, detail and protected cache", async () => {
  const response = deferred<{ task: Partial<Task> }>();
  const { planning } = createPlanningState({
    userId: "user-a", initialData: initial,
    adapter: { saveTask: () => response.promise, readWorkspace: async () => ({ data: initial }) },
  });
  const saved = planning.saveTask(original, { title: "Saved" });
  expect(planning.board().tasks[0].title).toBe("Saved");
  expect(planning.taskDetail(original.id).saveStatus).toBe("saving");
  expect(planning.protectedCache()?.tasks[0]).toMatchObject({ title: "Before", updatedAt: "r1" });
  response.resolve({ task: { id: original.id, title: "Saved", updatedAt: "r2" } });
  await expect(saved).resolves.toMatchObject({ ok: true });
  expect(planning.board().tasks[0]).toMatchObject({ title: "Saved", updatedAt: "r2" });
  expect(planning.taskDetail(original.id)).toMatchObject({ task: { title: "Saved", updatedAt: "r2" }, saveStatus: "saved" });
  expect(planning.protectedCache()?.tasks[0]).toMatchObject({ title: "Saved", updatedAt: "r2" });
});

test("an older Board refresh cannot replace a subsequently confirmed task in either view or cache", async () => {
  const read = deferred<typeof initial>();
  const { planning } = createPlanningState({
    userId: "user-a", initialData: initial,
    adapter: { saveTask: async () => ({ task: { id: original.id, title: "Saved", updatedAt: "r2" } }), readWorkspace: async () => ({ data: await read.promise }) },
  });
  const refreshed = planning.refreshWorkspace("planning");
  await planning.saveTask(original, { title: "Saved" });
  read.resolve(initial);
  await refreshed;
  expect(planning.board().tasks[0]).toMatchObject({ title: "Saved", updatedAt: "r2" });
  expect(planning.protectedCache()?.tasks[0]).toMatchObject({ title: "Saved", updatedAt: "r2" });
});

test("a rejected edit removes only its optimistic effects and preserves an independent confirmed save", async () => {
  const rejected = deferred<{ task: Partial<Task> }>();
  const other = { ...original, id: "task-b", title: "Other" };
  const { planning } = createPlanningState({
    userId: "user-a", initialData: { ...initial, tasks: [original, other] },
    adapter: { saveTask: task => task.id === original.id ? rejected.promise : Promise.resolve({ task: { id: other.id, title: "Confirmed other", updatedAt: "b2" } }), readWorkspace: async () => ({ data: initial }) },
  });
  const first = planning.saveTask(original, { title: "Rejected" });
  await planning.saveTask(other, { title: "Confirmed other" });
  rejected.reject(Object.assign(new Error("Forbidden"), { status: 403 }));
  await expect(first).resolves.toMatchObject({ ok: false });
  expect(planning.taskDetail(original.id)).toMatchObject({ task: { title: "Before" }, saveStatus: "rejected" });
  expect(planning.taskDetail(other.id).task).toMatchObject({ title: "Confirmed other", updatedAt: "b2" });
  expect(planning.protectedCache()?.tasks.find(task => task.id === other.id)).toMatchObject({ title: "Confirmed other", updatedAt: "b2" });
});

test.each([null, "user-b"])("ended or replaced sessions cannot publish late saves, reads or protected cache (%s)", async replacement => {
  const write = deferred<{ task: Partial<Task> }>();
  const read = deferred<typeof initial>();
  let sessionChanged!: (userId: string | null) => void;
  const { planning } = createPlanningState({
    userId: "user-a", initialData: initial,
    adapter: { saveTask: () => write.promise, readWorkspace: async () => ({ data: await read.promise }), subscribeSession: listener => { sessionChanged = listener; return () => {}; } },
  });
  const refreshing = planning.refreshWorkspace("planning");
  const saving = planning.saveTask(original, { title: "Late" });
  sessionChanged(replacement);
  write.resolve({ task: { title: "Late", updatedAt: "r2" } });
  read.resolve(initial);
  await Promise.all([refreshing, saving]);
  expect(planning.board().tasks).toEqual([]);
  expect(planning.taskDetail(original.id).task).toBeNull();
  expect(planning.protectedCache()).toBeNull();
});

test("a successful HTTP result without an authoritative revision cannot mark the task saved or enter confirmed cache", async () => {
  const { planning } = createPlanningState({ userId: "user-a", initialData: initial, adapter: {
    saveTask: async () => ({ task: { title: "Unproven" } }), readWorkspace: async () => ({ data: initial }),
  } });
  await expect(planning.saveTask(original, { title: "Unproven" })).resolves.toMatchObject({ ok: false });
  expect(planning.taskDetail(original.id)).toMatchObject({ task: { title: "Unproven" }, saveStatus: "unconfirmed" });
  expect(planning.protectedCache()?.tasks[0]).toMatchObject({ title: "Before", updatedAt: "r1" });
});

test("a read outside task scope cannot clear a task already confirmed by an edit", async () => {
  const { planning } = createPlanningState({ userId: "user-a", initialData: initial, adapter: {
    saveTask: async () => ({ task: { title: "Saved", updatedAt: "r2" } }),
    readWorkspace: async () => ({ data: emptyPlanningShellState, taskCoverage: "none" }),
  } });
  await planning.saveTask(original, { title: "Saved" });
  await planning.refreshWorkspace("tools");
  expect(planning.taskDetail(original.id).task).toMatchObject({ title: "Saved", updatedAt: "r2" });
  expect(planning.protectedCache()?.tasks[0]).toMatchObject({ title: "Saved", updatedAt: "r2" });
});
