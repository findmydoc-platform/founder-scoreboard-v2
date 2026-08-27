import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";








test("an approved task can request review through the status control", async () => {
  const [taskSurface, mutationContract] = await Promise.all([
    readFile("src/features/tasks/organisms/task-detail-surface.tsx", "utf8"),
    readFile("src/features/tasks/model/task-mutation-contract.ts", "utf8"),
  ]);

  assert.match(taskSurface, /canChangeStatus=\{controller\.permissions\.canUpdateStatus && effectivelyApproved && canSelectNextStatus\}/);
  assert.match(mutationContract, /normalizedPatch\.status === "Review"/);
  assert.match(mutationContract, /status: "Review",\s*reviewStatus: "requested"/);
});
