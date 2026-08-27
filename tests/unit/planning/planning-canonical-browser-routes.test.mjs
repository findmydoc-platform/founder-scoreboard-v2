import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

test("Initiative editing sends parent, strategy, and RACI in one request", async () => {
  const client = await importTestModule("src/features/planning/model/planning-api-client.ts");
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
