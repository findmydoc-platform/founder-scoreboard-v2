import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const activeTaskReaders = [
  "src/app/api/tasks/route.ts",
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

  const initiativeRoute = await readFile("src/app/api/initiatives/route.ts", "utf8");
  assert.match(initiativeRoute, /ACTIVE_PACKAGES_TABLE/);
  assert.doesNotMatch(initiativeRoute, /\.from\("packages"\)\s*\.select/);

  const createTaskRoute = sources[0];
  assert.match(createTaskRoute, /ACTIVE_PACKAGES_TABLE/);
  assert.doesNotMatch(createTaskRoute, /\.from\("tasks"\)\s*\.select/);

  const digest = sources[1];
  assert.match(digest, /if \(!task\) continue/);
});

test("trash detail and mutation writes retain explicit base-table access", async () => {
  const [detail, taskRoute] = await Promise.all([
    readFile("src/lib/planning-trash-detail.ts", "utf8"),
    readFile("src/app/api/tasks/[id]/route.ts", "utf8"),
  ]);
  assert.match(detail, /\.from\("tasks"\)/);
  assert.match(detail, /\.from\("packages"\)/);
  assert.match(taskRoute, /requireActivePlanningItem/);
  assert.match(taskRoute, /\.from\("tasks"\)/);
});
