import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const missing = async (path) => access(path).then(() => false, () => true);

test("Browser planning mutations use one canonical task route family", async () => {
  const [client, taskCollection, taskItem, approval, withdraw, restore] = await Promise.all([
    readFile("src/features/planning/model/planning-api-client.ts", "utf8"),
    readFile("src/app/api/tasks/route.ts", "utf8"),
    readFile("src/app/api/tasks/[id]/route.ts", "utf8"),
    readFile("src/app/api/tasks/[id]/approval/route.ts", "utf8"),
    readFile("src/app/api/tasks/[id]/withdraw/route.ts", "utf8"),
    readFile("src/app/api/tasks/[id]/restore/route.ts", "utf8"),
  ]);

  assert.doesNotMatch(client, /\/api\/(?:milestones|initiatives)/);
  assert.match(client, /\/api\/tasks/);
  assert.match(taskCollection, /handleBrowserTaskCreate/);
  assert.match(taskItem, /handleBrowserTaskUpdate/);
  assert.match(taskItem, /handleBrowserTaskDelete/);
  assert.match(approval, /item\.task_type !== "initiative" && item\.task_type !== "deliverable"/);
  assert.match(withdraw, /handlePlanningTrashWithdraw\(request, id\)/);
  assert.match(restore, /handlePlanningTrashRestore\(request, id\)/);
});

test("legacy Browser planning route files are removed", async () => {
  for (const path of [
    "src/app/api/initiatives/route.ts",
    "src/app/api/initiatives/[id]/route.ts",
    "src/app/api/initiatives/[id]/approval/route.ts",
    "src/app/api/initiatives/[id]/withdraw/route.ts",
    "src/app/api/initiatives/[id]/restore/route.ts",
    "src/app/api/milestones/route.ts",
    "src/app/api/milestones/[id]/route.ts",
  ]) {
    assert.equal(await missing(path), true, `${path} must stay retired`);
  }
});

test("canonical Browser payloads use parent and owner identifiers", async () => {
  const [client, reparent, taskMutation] = await Promise.all([
    readFile("src/features/planning/model/planning-api-client.ts", "utf8"),
    readFile("src/features/planning-items/model/planning-items-reparent.ts", "utf8"),
    readFile("src/features/tasks/model/task-mutation-contract.ts", "utf8"),
  ]);
  assert.match(client, /parentTaskId: draft\.milestoneId/);
  assert.match(client, /owner: draft\.ownerId/);
  assert.doesNotMatch(client, /json: draft/);
  assert.doesNotMatch(reparent, /Object\.hasOwn\(row, "packageId"\)/);
  assert.doesNotMatch(taskMutation, /^\s+packageId: patch\./m);
  assert.doesNotMatch(taskMutation, /^\s+milestoneId: patch\./m);
});
