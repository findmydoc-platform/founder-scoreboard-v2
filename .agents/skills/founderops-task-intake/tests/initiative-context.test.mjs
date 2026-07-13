import assert from "node:assert/strict";
import test from "node:test";
import { placementCandidates, validateInitiativeContextResponse } from "../scripts/initiative-context.mjs";

function initiative(id, approvalStatus, overrides = {}) {
  return {
    id,
    title: `Initiative ${id}`,
    approvalStatus,
    goal: `Goal ${id}`,
    scopeConstraints: `Scope ${id}`,
    successCriteria: `Success ${id}`,
    milestoneId: "milestone-1",
    accountableProfileId: "accountable-1",
    responsibleProfileIds: ["responsible-1"],
    ...overrides,
  };
}

function context(initiatives) {
  return { ok: true, context: { initiatives } };
}

test("accepts the fixed Initiative context contract", () => {
  const response = context([initiative("one", "approved")]);
  assert.equal(validateInitiativeContextResponse(response), response);
});

test("keeps all non-rejected candidates for semantic placement assessment", () => {
  const response = context([
    initiative("strong-fit", "approved"),
    initiative("possible-fit", "proposed"),
    initiative("excluded", "rejected"),
  ]);

  assert.deepEqual(placementCandidates(response).map((entry) => entry.id), ["strong-fit", "possible-fit"]);
});

test("supports the no-fit path when no eligible Initiative exists", () => {
  const response = context([initiative("rejected", "rejected")]);
  assert.deepEqual(placementCandidates(response), []);
});

test("rejects the older Initiative context without detailed placement fields", () => {
  assert.throws(
    () => validateInitiativeContextResponse(context([{ id: "legacy", title: "Legacy" }])),
    /approvalStatus/,
  );
});

test("rejects invalid approval status and missing semantic fields", () => {
  assert.throws(
    () => validateInitiativeContextResponse(context([initiative("invalid", "withdrawn")])),
    /approvalStatus/,
  );
  assert.throws(
    () => validateInitiativeContextResponse(context([initiative("missing", "approved", { goal: null })])),
    /goal/,
  );
});

