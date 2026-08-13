import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const activeTaskReaders = [
  "src/features/planning-items/model/planning-items-browser-task-create.ts",
  "src/app/api/notifications/generate-digest/route.ts",
  "src/app/api/focus/route.ts",
  "src/app/api/sprints/route.ts",
  "src/app/api/sprints/[id]/route.ts",
  "src/app/api/sprints/[id]/lock/route.ts",
  "src/lib/github-comment-delivery.ts",
  "src/lib/notification-resolution.ts",
];

test("operational planning readers use centralized active views", async () => {
  const sources = await Promise.all(activeTaskReaders.map((path) => readFile(path, "utf8")));
  for (const [index, source] of sources.entries()) {
    assert.match(source, /ACTIVE_TASKS_TABLE/, `${activeTaskReaders[index]} must use the active task boundary`);
  }

  const createTaskRoute = sources[0];
  assert.match(createTaskRoute, /ACTIVE_TASKS_TABLE/);
  assert.doesNotMatch(createTaskRoute, /\.from\("tasks"\)\s*\.select/);
  assert.doesNotMatch(createTaskRoute, /\.from\("planning_item_historical_links"\)|package_id|milestone_id/);
  assert.match(createTaskRoute, /Object\.hasOwn\(payload, "packageId"\)/);
  assert.match(createTaskRoute, /Object\.hasOwn\(payload, "assignee"\)/);
  assert.match(createTaskRoute, /payload\.ownerId/);

  const digest = sources[1];
  assert.match(digest, /if \(!task\) continue/);
});

test("trash detail and mutation guards use only the canonical planning item table", async () => {
  const [detail, taskRoute] = await Promise.all([
    readFile("src/lib/planning-trash-detail.ts", "utf8"),
    readFile("src/features/planning-items/model/planning-items-browser-task-update.ts", "utf8"),
  ]);
  assert.match(detail, /\.from\("tasks"\)/);
  assert.doesNotMatch(detail, /\.from\("packages"\)|\.from\("milestones"\)|package_id|milestone_id/);
  assert.match(taskRoute, /requireActivePlanningItem/);
  assert.match(taskRoute, /\.from\("tasks"\)/);
  assert.doesNotMatch(taskRoute, /ACTIVE_PACKAGES_TABLE|active_packages|package_id|milestone_id/);
  assert.match(taskRoute, /Object\.hasOwn\(rawPayload, "packageId"\)/);
  assert.match(taskRoute, /Object\.hasOwn\(rawPayload, "assignee"\)/);
  assert.match(taskRoute, /payload\.ownerId/);
});

test("active task projections and local fixtures expose only parentTaskId", async () => {
  const [mapper, taskTypes, seed] = await Promise.all([
    readFile("src/lib/planning-task-mappers.ts", "utf8"),
    readFile("src/lib/types.ts", "utf8"),
    readFile("src/lib/seed/source.json", "utf8"),
  ]);
  for (const source of [mapper, taskTypes, seed]) {
    assert.doesNotMatch(source, /\bpackageId\b|\bmilestoneId\b|\bpackages\b|\bmilestones\b/);
  }
  assert.match(mapper, /parentTaskId: row\.parent_task_id/);
  assert.match(seed, /"initiatives"/);
});
