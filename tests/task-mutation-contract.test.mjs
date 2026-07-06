import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const planningAppModelMock = {
  reviewOwnerForTask: () => "accountable",
  taskOwnerPatch: () => ({}),
};

const slugMock = {
  slugify: (value) => String(value || "").trim().toLowerCase().replace(/\s+/g, "-"),
};

test("review request payload omits protected score and review owner fields", async () => {
  const { buildClientTaskUpdatePatch, taskUpdateRequestPayload } = await loadTranspiledModule("src/features/tasks/model/task-mutation-contract.ts", {
    "@/features/planning/model/planning-app-model": planningAppModelMock,
    "@/lib/slug": slugMock,
  });

  const normalized = buildClientTaskUpdatePatch(
    { id: "task-1", status: "In Arbeit", scoreFinal: false, packageId: "initiative-1" },
    { status: "Review" },
    [],
    [{ id: "initiative-1", ownerId: "owner", accountableProfileId: "accountable" }],
    "2026-07-06T12:00:00.000Z",
  );

  assert.equal(normalized.ok, true);
  assert.equal(normalized.patch.status, "Review");
  assert.equal(normalized.patch.reviewStatus, "requested");
  assert.equal(normalized.patch.scoreFinal, false);
  assert.equal(normalized.patch.reviewOwnerProfileId, "accountable");

  const payload = taskUpdateRequestPayload(normalized.patch);

  assert.equal(payload.status, "Review");
  assert.equal(payload.reviewStatus, "requested");
  assert.equal(payload.scoreFinal, undefined);
  assert.equal(payload.reviewOwnerProfileId, undefined);
});

test("score and review owner payload fields remain available outside review requests", async () => {
  const { taskUpdateRequestPayload } = await loadTranspiledModule("src/features/tasks/model/task-mutation-contract.ts", {
    "@/features/planning/model/planning-app-model": planningAppModelMock,
    "@/lib/slug": slugMock,
  });

  const payload = taskUpdateRequestPayload({
    reviewOwnerProfileId: "ceo",
    scoreFinal: true,
    scorePoints: 8,
  });

  assert.equal(payload.reviewOwnerProfileId, "ceo");
  assert.equal(payload.scoreFinal, true);
  assert.equal(payload.scorePoints, 8);
});

test("task route guard allows only the implicit score reset for review requests", async () => {
  const { restrictedTaskUpdateFields } = await loadTranspiledModule("src/features/tasks/model/task-route-update-helpers.ts", {
    "@/features/tasks/model/task-mutation-contract": { taskOwnedByProfile: () => true },
    "@/lib/status": { taskStatuses: ["Vorschlag", "Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt"] },
  });

  assert.deepEqual(restrictedTaskUpdateFields({ status: "Review", reviewStatus: "requested", scoreFinal: false }), []);
  assert.deepEqual(restrictedTaskUpdateFields({ status: "Review", scoreFinal: true }), ["Score"]);
  assert.deepEqual(restrictedTaskUpdateFields({ status: "Review", scorePoints: 8 }), ["Score"]);
  assert.deepEqual(restrictedTaskUpdateFields({ scoreFinal: false }), ["Score"]);
});
