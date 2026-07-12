import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const selection = await loadTranspiledModule("src/features/tasks/model/task-panel-selection.ts");

test("task panel selection starts pushes navigates back and closes", () => {
  const available = new Set(["task-a", "task-b", "task-c"]);
  const started = selection.startTaskPanelHistory("task-a", available);
  const pushed = selection.pushTaskPanelHistory(started, "task-b", available);
  const nested = selection.pushTaskPanelHistory(pushed, "task-c", available);

  assert.deepEqual(started, ["task-a"]);
  assert.deepEqual(nested, ["task-a", "task-b", "task-c"]);
  assert.equal(selection.currentTaskPanelId(nested), "task-c");
  assert.deepEqual(selection.backTaskPanelHistory(nested), ["task-a", "task-b"]);
  assert.deepEqual(selection.closeTaskPanelHistory(), []);
});

test("task panel selection ignores duplicates and unavailable tasks", () => {
  const available = new Set(["task-a", "task-b"]);
  const history = ["task-a", "task-b"];

  assert.equal(selection.pushTaskPanelHistory(history, "task-b", available), history);
  assert.deepEqual(selection.pushTaskPanelHistory(history, "task-a", available), ["task-b", "task-a"]);
  assert.equal(selection.pushTaskPanelHistory(history, "missing", available), history);
  assert.deepEqual(selection.startTaskPanelHistory("missing", available), []);
  assert.deepEqual(selection.normalizeTaskPanelHistory(["task-a", "missing", "task-b"], available), ["task-a", "task-b"]);
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
