import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const selection = await importTestModule("src/features/tasks/model/task-panel-selection.ts");

test("task panel selection starts pushes navigates back and closes", () => {
  const removed = new Set();
  const started = selection.startTaskPanelHistory("task-a", removed);
  const pushed = selection.pushTaskPanelHistory(started, "task-b", removed);
  const nested = selection.pushTaskPanelHistory(pushed, "task-c", removed);

  assert.deepEqual(started, ["task-a"]);
  assert.deepEqual(nested, ["task-a", "task-b", "task-c"]);
  assert.equal(selection.currentTaskPanelId(nested), "task-c");
  assert.deepEqual(selection.backTaskPanelHistory(nested), ["task-a", "task-b"]);
  assert.deepEqual(selection.closeTaskPanelHistory(), []);
});

test("task panel selection ignores duplicates and confirmed removed tasks", () => {
  const removed = new Set(["missing"]);
  const history = ["task-a", "task-b"];

  assert.equal(selection.pushTaskPanelHistory(history, "task-b", removed), history);
  assert.deepEqual(selection.pushTaskPanelHistory(history, "task-a", removed), ["task-b", "task-a"]);
  assert.equal(selection.pushTaskPanelHistory(history, "missing", removed), history);
  assert.deepEqual(selection.startTaskPanelHistory("missing", removed), []);
  assert.deepEqual(selection.normalizeTaskPanelHistory(["task-a", "missing", "task-b"], removed), ["task-a", "task-b"]);
});

test("parent navigation replaces the current panel item and returns to the child", () => {
  const removed = new Set();
  const childHistory = selection.startTaskPanelHistory("child", removed);
  const parentHistory = selection.pushTaskPanelHistory(childHistory, "parent", removed);

  assert.equal(selection.currentTaskPanelId(parentHistory), "parent");
  assert.deepEqual(selection.backTaskPanelHistory(parentHistory), ["child"]);
});

test("task references use the drawer only for unmodified primary clicks", () => {
  const base = { button: 0, altKey: false, ctrlKey: false, metaKey: false, shiftKey: false };

  assert.equal(selection.shouldOpenTaskReferenceInPanel(base), true);
  assert.equal(selection.shouldOpenTaskReferenceInPanel({ ...base, button: 1 }), false);
  assert.equal(selection.shouldOpenTaskReferenceInPanel({ ...base, ctrlKey: true }), false);
  assert.equal(selection.shouldOpenTaskReferenceInPanel({ ...base, metaKey: true }), false);
  assert.equal(selection.shouldOpenTaskReferenceInPanel({ ...base, shiftKey: true }), false);
  assert.equal(selection.shouldOpenTaskReferenceInPanel({ ...base, altKey: true }), false);
});


test("task panel selection retains unloaded target IDs while rejecting confirmed removals", () => {
  const removed = new Set(["removed-task"]);
  const started = selection.startTaskPanelHistory("unloaded-task", removed);
  const next = selection.pushTaskPanelHistory(started, "another-unloaded-task", removed);
  assert.deepEqual(next, ["unloaded-task", "another-unloaded-task"]);
  assert.deepEqual(selection.startTaskPanelHistory("removed-task", removed), []);
  assert.deepEqual(selection.startTaskPanelHistory(" ", removed), []);
  assert.deepEqual(selection.normalizeTaskPanelHistory([...next, "removed-task"], removed), next);
});
