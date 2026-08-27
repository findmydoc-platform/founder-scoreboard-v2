import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");



test("normal planning reads use the centralized active read models", async () => {
  const [readModel, workspaceReadSource, backlog, planningContext, planningItemsCreate, taskDetail] = await Promise.all([
    read("src/lib/planning-read-model.ts"),
    read("src/features/planning-items/server/planning-workspace-read-source.ts"),
    read("src/features/backlog/server/backlog-read-model-supabase.ts"),
    read("src/features/planning-items/model/planning-items-context.ts"),
    read("src/features/planning-items/model/planning-items-create.ts"),
    read("src/features/tasks/server/task-detail-read-model-supabase.ts"),
  ]);

  assert.doesNotMatch(readModel, /ACTIVE_PACKAGES_TABLE|active_packages/);
  assert.match(readModel, /ACTIVE_TASKS_TABLE = "active_tasks"/);
  for (const source of [workspaceReadSource, backlog, planningContext, planningItemsCreate, taskDetail]) {
    assert.match(source, /ACTIVE_TASKS_TABLE/);
  }
  for (const source of [workspaceReadSource, backlog, planningContext, planningItemsCreate]) {
    assert.doesNotMatch(source, /ACTIVE_PACKAGES_TABLE/);
  }
  await assert.rejects(() => read("src/lib/planning-data-loader.ts"), /ENOENT/);
});

test("schema verification covers canonical trash metadata and the active task view", async () => {
  const checks = JSON.parse(await read("src/lib/planning-schema-checks.json"));
  const names = new Set(checks.map((entry) => entry.name));

  assert.ok(names.has("tasks.trash"));
  assert.ok(names.has("active_tasks"));
});
