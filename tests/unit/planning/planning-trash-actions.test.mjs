import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const trashPolicy = await importTestModule(
  "src/features/planning/model/planning-trash-contract.ts",
  {
    "@/lib/platform": {
      isOperationalLeadRole: (role) => role === "ceo" || role === "deputy",
    },
  },
);

test("planning trash policy requires a bounded reason and positive revisions", () => {
  assert.equal(trashPolicy.PLANNING_TRASH_REASON_MAX_LENGTH, 2000);
  assert.deepEqual(trashPolicy.validatePlanningTrashReason("  Nicht mehr relevant.  "), {
    ok: true,
    reason: "Nicht mehr relevant.",
  });
  assert.deepEqual(trashPolicy.validatePlanningTrashReason("   "), { ok: false, reason: "required" });
  assert.deepEqual(trashPolicy.validatePlanningTrashReason("x".repeat(2001)), { ok: false, reason: "too_long" });
  assert.equal(trashPolicy.validatePlanningTrashRevision(1), true);
  assert.equal(trashPolicy.validatePlanningTrashRevision(0), false);
  assert.equal(trashPolicy.validatePlanningTrashRevision(1.5), false);
});

test("only proposer or operational lead may withdraw draft and proposed roots", () => {
  const proposed = { rootType: "deliverable", approvalStatus: "proposed", proposedById: "founder-1" };
  assert.equal(trashPolicy.canWithdrawPlanningRoot(proposed, { id: "founder-1", platformRole: "founder" }), true);
  assert.equal(trashPolicy.canWithdrawPlanningRoot(proposed, { id: "founder-2", platformRole: "founder" }), false);
  assert.equal(trashPolicy.canWithdrawPlanningRoot(proposed, { id: "deputy", platformRole: "deputy" }), true);
  assert.equal(trashPolicy.canWithdrawPlanningRoot({ ...proposed, approvalStatus: "approved" }, { id: "ceo", platformRole: "ceo" }), false);
  assert.equal(trashPolicy.canRestorePlanningRoot({ id: "deputy", platformRole: "deputy" }), true);
  assert.equal(trashPolicy.canRestorePlanningRoot({ id: "founder-1", platformRole: "founder" }), false);
});
