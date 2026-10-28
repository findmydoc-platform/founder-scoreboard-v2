import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

test("the canonical Task API preserves pure reparent CAS and separate strategic content payloads", async () => {
  const client = await importTestModule("src/features/tasks/model/task-api-client.ts");
  const calls = [];
  const apiClient = { requestJson: async (path, options) => { calls.push({ path, options }); return { response: { ok: true }, body: { task: { id: "initiative-1" } } }; } };
  await client.updateTaskRequest(apiClient, "initiative-1", { expectedUpdatedAt: "original/source", parentTaskId: "epic-2" });
  await client.updateTaskRequest(apiClient, "initiative-1", { expectedUpdatedAt: "actual/reparent", title: "Launch readiness", strategy: { goal: "Ready for launch", successCriteria: "All gates pass", scopeConstraints: "No scope expansion" }, raciAssignments: [{ profileId: "ceo", role: "accountable", sortOrder: 0 }] });
  assert.deepEqual(calls[0], { path: "/api/tasks/initiative-1", options: { method: "PATCH", json: { expectedUpdatedAt: "original/source", parentTaskId: "epic-2" } } });
  assert.equal(calls[1].options.json.expectedUpdatedAt, "actual/reparent");
  assert.equal(Object.hasOwn(calls[1].options.json, "parentTaskId"), false);
  assert.equal(calls[1].options.json.strategy.goal, "Ready for launch");
});
