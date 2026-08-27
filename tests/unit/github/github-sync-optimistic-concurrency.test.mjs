import assert from "node:assert/strict";
import { test } from "vitest";
import { loadTranspiledModule } from "../../helpers/transpile-module.mjs";

test("GitHub sync advances the shared task revision used by the next edit", async () => {
  const { rememberTaskServerRevision, taskServerRevision } = await loadTranspiledModule(
    "src/features/tasks/model/task-server-revision.ts",
  );
  const store = { current: new Map() };
  const task = { id: "task-1", updatedAt: "revision-before-status" };

  rememberTaskServerRevision(store, task.id, "revision-after-status");
  assert.equal(taskServerRevision(store, task), "revision-after-status");

  rememberTaskServerRevision(store, task.id, "revision-after-sync");
  assert.equal(taskServerRevision(store, task), "revision-after-sync");
});
