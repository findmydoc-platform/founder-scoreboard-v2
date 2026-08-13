import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

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
  assert.match(client, /parentTaskId: draft\.parentTaskId/);
  assert.match(client, /ownerId: draft\.ownerId/);
  assert.doesNotMatch(client, /^\s+owner: draft\.ownerId/m);
  assert.doesNotMatch(client, /json: draft/);
  assert.doesNotMatch(reparent, /Object\.hasOwn\(row, "packageId"\)/);
  assert.doesNotMatch(taskMutation, /^\s+packageId: patch\./m);
  assert.doesNotMatch(taskMutation, /^\s+milestoneId: patch\./m);
  assert.match(taskMutation, /^\s+ownerId: patch\./m);
  assert.doesNotMatch(taskMutation, /^\s+assignee: patch\./m);
});

test("Initiative editing sends parent, strategy, and RACI in one request", async () => {
  const client = await loadTranspiledModule("src/features/planning/model/planning-api-client.ts");
  const calls = [];
  const apiClient = {
    async requestJson(path, options) {
      calls.push({ path, options });
      return { response: { ok: true }, body: { task: { id: "initiative-1" } } };
    },
  };
  await client.saveInitiativeRequest(apiClient, {
    id: "initiative-1",
    creationRequestId: "unused",
    expectedUpdatedAt: "2026-08-13T08:00:00.000Z",
    title: "Launch readiness",
    goal: "Ready for launch",
    successCriteria: "All gates pass",
    scopeConstraints: "No scope expansion",
    ownerId: "ceo",
    accountableProfileId: "ceo",
    responsibleProfileIds: ["founder"],
    consultedProfileIds: [],
    informedProfileIds: [],
    priority: "P1",
    status: "active",
    targetDate: "2026-09-01",
    parentTaskId: "epic-2",
    approveNow: false,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, "/api/tasks/initiative-1");
  assert.equal(calls[0].options.json.parentTaskId, "epic-2");
  assert.equal(calls[0].options.json.strategy.goal, "Ready for launch");
  assert.deepEqual(calls[0].options.json.raciAssignments, [
    { profileId: "ceo", role: "accountable", sortOrder: 0 },
    { profileId: "founder", role: "responsible", sortOrder: 0 },
  ]);
});
