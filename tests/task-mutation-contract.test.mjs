import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const planningAppModelMock = {
  reviewOwnerForTask: () => "accountable",
  taskAssigneePatch: () => ({}),
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

  const payload = taskUpdateRequestPayload(normalized.patch, "2026-07-06T11:00:00.000Z");

  assert.equal(payload.expectedUpdatedAt, "2026-07-06T11:00:00.000Z");
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
  }, "2026-07-06T11:00:00.000Z");

  assert.equal(payload.reviewOwnerProfileId, "ceo");
  assert.equal(payload.scoreFinal, true);
  assert.equal(payload.scorePoints, 8);
});

test("task brief fields stay together in the shared update payload", async () => {
  const { taskUpdateRequestPayload } = await loadTranspiledModule("src/features/tasks/model/task-mutation-contract.ts", {
    "@/features/planning/model/planning-app-model": planningAppModelMock,
    "@/lib/slug": slugMock,
  });

  const payload = taskUpdateRequestPayload({
    problemStatement: "Problem",
    intendedOutcome: "Zielbild",
    scopeConstraints: "Umfang",
    acceptanceCriteria: "Kriterium",
    evidenceRequired: "Nachweis",
    definitionOfDone: "Qualitätsstandard",
  }, "2026-07-12T10:00:00.000Z");

  assert.equal(payload.problemStatement, "Problem");
  assert.equal(payload.intendedOutcome, "Zielbild");
  assert.equal(payload.scopeConstraints, "Umfang");
  assert.equal(payload.acceptanceCriteria, "Kriterium");
  assert.equal(payload.evidenceRequired, "Nachweis");
  assert.equal(payload.definitionOfDone, "Qualitätsstandard");
});

test("task route guard allows only the implicit score reset for review requests", async () => {
  const { restrictedTaskUpdateFields } = await loadTranspiledModule("src/features/tasks/model/task-route-update-helpers.ts", {
    "@/features/tasks/model/task-mutation-contract": { taskAssignedToProfile: () => true },
    "@/lib/status": { taskStatuses: ["Vorschlag", "Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt"] },
  });

  assert.deepEqual(restrictedTaskUpdateFields({ status: "Review", reviewStatus: "requested", scoreFinal: false }), []);
  assert.deepEqual(restrictedTaskUpdateFields({ status: "Review", scoreFinal: true }), ["Score"]);
  assert.deepEqual(restrictedTaskUpdateFields({ status: "Review", scorePoints: 8 }), ["Score"]);
  assert.deepEqual(restrictedTaskUpdateFields({ scoreFinal: false }), ["Score"]);
});

test("task route guard keeps final status CEO-only", async () => {
  const { applyFinalStatusReopen, validateTaskStatusUpdate } = await loadTranspiledModule("src/features/tasks/model/task-route-update-helpers.ts", {
    "@/features/tasks/model/task-mutation-contract": { taskAssignedToProfile: () => true },
    "@/lib/status": {
      normalizeStatus: (status) => status,
      taskStatuses: ["Vorschlag", "Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt"],
    },
  });

  assert.deepEqual(
    validateTaskStatusUpdate({
      currentTask: { status: "Offen", assignee: "founder-1" },
      isOperationalLead: true,
      isCeo: false,
      payload: { status: "Erledigt" },
      profile: { id: "founder-1" },
    }),
    { ok: false, error: "Founder können Aufgaben nur in Review geben. Final erledigt wird im CEO-Review gesetzt.", status: 403 },
  );

  assert.deepEqual(
    validateTaskStatusUpdate({
      currentTask: { status: "Erledigt", assignee: "founder-1" },
      isOperationalLead: true,
      isCeo: false,
      payload: { status: "In Arbeit" },
      profile: { id: "founder-1" },
    }),
    { ok: false, error: "Diese Aufgabe ist final erledigt. Nur CEO kann sie wieder öffnen.", status: 403 },
  );

  assert.deepEqual(
    validateTaskStatusUpdate({
      currentTask: { status: "Erledigt", assignee: "founder-1" },
      isOperationalLead: true,
      isCeo: true,
      payload: { status: "Review" },
      profile: { id: "ceo" },
    }),
    { ok: true },
  );

  const update = {};
  applyFinalStatusReopen(update, { status: "Erledigt" }, { status: "Review" }, true);
  assert.equal(update.score_final, false);
  assert.equal(update.review_status, "requested");
  assert.equal(typeof update.review_requested_at, "string");
});
