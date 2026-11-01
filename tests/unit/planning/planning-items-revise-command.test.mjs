import assert from "node:assert/strict";
import { test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

async function loadUpdateModel() {
  return importTestModule("src/features/planning-items/model/planning-item-update.ts", { "server-only": {} });
}

test("Team revise accepts fixedDate and rejects legacy deliverable schedule fields", async () => {
  const model = await loadUpdateModel();
  const expectedUpdatedAt = "2026-08-12T10:00:00.000Z";
  const valid = model.parsePlanningItemPatchPayload({ expectedUpdatedAt, fixedDate: "2026-09-10" });
  assert.equal(valid.ok, true);
  assert.deepEqual(valid.presentFields, ["fixedDate"]);

  for (const field of ["startDate", "endDate", "deadline"]) {
    const result = model.parsePlanningItemPatchPayload({ expectedUpdatedAt, [field]: "2026-09-10" });
    assert.equal(result.ok, false);
    assert.match(result.error, new RegExp(`unbekannte Feld ${field}`));
  }
});

test("Team revise routes dependency commands through the existing update contract", async () => {
  const model = await loadUpdateModel();
  const expectedUpdatedAt = "2026-09-12T10:00:00.000Z";
  const parsed = model.parsePlanningItemPatchPayload({
    expectedUpdatedAt,
    dependency: {
      operation: "add",
      direction: "blocks",
      relatedItemId: "related",
      note: "External approval",
    },
  });

  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.presentFields, []);
  assert.deepEqual(parsed.dependency, {
    operation: "add",
    direction: "blocks",
    relatedItemId: "related",
    note: "External approval",
  });
  assert.equal(model.parsePlanningItemPatchPayload({
    expectedUpdatedAt,
    title: "Mixed",
    dependency: { operation: "remove", relationshipId: 41 },
  }).ok, false);
  assert.equal(model.parsePlanningItemPatchPayload({
    expectedUpdatedAt,
    dependency: { operation: "add", direction: "relates_to", relatedItemId: "related" },
  }).ok, false);
});
