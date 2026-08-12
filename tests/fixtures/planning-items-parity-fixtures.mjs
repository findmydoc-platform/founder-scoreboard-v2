const command = {
  kind: "reviseItem",
  itemId: "deliverable-1",
  expectedRevision: "2026-08-12T10:00:00.000Z",
  changes: { itemKind: "deliverable", title: "Release readiness" },
};

function observation({ statusCode, payload, revision, writeCount, createdEffectIds = [], replayLedgerWrites = 0, idempotencyFingerprint = "sha256:revise-deliverable-1" }) {
  return {
    statusCode,
    payload,
    canonicalCommand: command,
    revision,
    idempotencyFingerprint,
    writeCount,
    createdEffectIds,
    replayLedgerWrites,
  };
}

export const planningBehaviorCases = [
  {
    id: "revise-deliverable-preview",
    parityKey: "revise-deliverable",
    phase: "preview",
    input: { mode: "preview", command },
    expected: {
      module: observation({
        statusCode: null,
        payload: {
          status: "previewed",
          changes: [{ field: "title", before: "Release", after: "Release readiness" }],
          warnings: [],
        },
        revision: "2026-08-12T10:00:00.000Z",
        writeCount: 0,
      }),
      browser: null,
      team: observation({
        statusCode: 200,
        payload: {
          ok: true,
          valid: true,
          itemId: "deliverable-1",
          expectedUpdatedAt: "2026-08-12T10:00:00.000Z",
          changedFields: ["title"],
          systemEffects: [],
          errors: [],
          warnings: [],
        },
        revision: "2026-08-12T10:00:00.000Z",
        writeCount: 0,
      }),
    },
  },
  {
    id: "revise-deliverable-commit",
    parityKey: "revise-deliverable",
    counterpartId: "revise-deliverable-preview",
    phase: "commit",
    input: { mode: "commit", command, idempotencyKey: "00000000-0000-4000-8000-000000000001" },
    expected: {
      module: observation({
        statusCode: null,
        payload: {
          status: "committed",
          replayed: false,
          changes: [{ field: "title", before: "Release", after: "Release readiness" }],
          effects: ["activity-1", "audit-1"],
        },
        revision: "2026-08-12T10:05:00.000Z",
        writeCount: 1,
        createdEffectIds: ["activity-1", "audit-1"],
        replayLedgerWrites: 1,
      }),
      browser: observation({
        statusCode: 200,
        payload: {
          ok: true,
          task: { id: "deliverable-1", title: "Release readiness", updatedAt: "2026-08-12T10:05:00.000Z" },
          activities: [{ id: "activity-1", message: "Titel geändert" }],
        },
        revision: "2026-08-12T10:05:00.000Z",
        writeCount: 1,
        createdEffectIds: ["activity-1", "audit-1"],
        idempotencyFingerprint: null,
      }),
      team: observation({
        statusCode: 200,
        payload: {
          ok: true,
          replayed: false,
          itemType: "deliverable",
          item: { id: "deliverable-1", title: "Release readiness", updatedAt: "2026-08-12T10:05:00.000Z" },
          changedFields: ["title"],
          systemEffects: [{ field: "activity", action: "created" }],
          itemLink: "/tasks/deliverable-1",
        },
        revision: "2026-08-12T10:05:00.000Z",
        writeCount: 1,
        createdEffectIds: ["activity-1", "audit-1"],
        replayLedgerWrites: 1,
      }),
    },
  },
  {
    id: "revise-deliverable-replay",
    parityKey: "revise-deliverable",
    counterpartId: "revise-deliverable-commit",
    phase: "replay",
    input: { mode: "commit", command, idempotencyKey: "00000000-0000-4000-8000-000000000001" },
    expected: {
      module: observation({
        statusCode: null,
        payload: {
          ok: true,
          status: "committed",
          replayed: true,
          receiptId: "receipt-revise-deliverable-1",
          originalRevision: "2026-08-12T10:05:00.000Z",
        },
        revision: "2026-08-12T10:05:00.000Z",
        writeCount: 0,
      }),
      browser: null,
      team: observation({
        statusCode: 200,
        payload: {
          ok: true,
          status: "committed",
          replayed: true,
          receiptId: "receipt-revise-deliverable-1",
          originalRevision: "2026-08-12T10:05:00.000Z",
        },
        revision: "2026-08-12T10:05:00.000Z",
        writeCount: 0,
      }),
    },
  },
  {
    id: "revise-deliverable-invalid",
    parityKey: "revise-deliverable-invalid",
    phase: "error",
    input: { mode: "commit", command: { ...command, changes: { ...command.changes, unsupported: true } } },
    expected: {
      module: observation({
        statusCode: null,
        payload: { ok: false, error: { code: "invalidCommand", issues: [{ path: "changes.unsupported", reason: "unknownField" }] } },
        revision: "2026-08-12T10:00:00.000Z",
        writeCount: 0,
      }),
      browser: observation({
        statusCode: 400,
        payload: { error: "Aufgabenänderung ist ungültig." },
        revision: "2026-08-12T10:00:00.000Z",
        writeCount: 0,
      }),
      team: observation({
        statusCode: 400,
        payload: { ok: false, error: "PATCH-Payload enthält das unbekannte Feld unsupported." },
        revision: "2026-08-12T10:00:00.000Z",
        writeCount: 0,
      }),
    },
  },
];

const reviseScope = "write:planning-items:update";

function authCase(id, actor, ownership, allowed, reason) {
  const decision = { allowed, reason };
  const browser = actor.binding === "planningToken" ? null : decision;
  const team = actor.binding === "planningToken" ? decision : null;
  return {
    id,
    commandKind: "reviseItem",
    actor,
    ownership,
    expected: { module: decision, database: decision, browser, team },
  };
}

export const planningAuthorizationCases = [
  authCase("mapped-ceo", { binding: "mapped", role: "ceo", scopes: [] }, "other", true, "role"),
  authCase("mapped-deputy", { binding: "mapped", role: "deputy", scopes: [] }, "other", true, "role"),
  authCase("mapped-founder-owner", { binding: "mapped", role: "founder", scopes: [] }, "owner", true, "ownership"),
  authCase("mapped-founder-other", { binding: "mapped", role: "founder", scopes: [] }, "other", false, "ownerMismatch"),
  authCase("mapped-viewer", { binding: "mapped", role: "viewer", scopes: [] }, "other", false, "readOnlyRole"),
  authCase("unmapped-session", { binding: "unmapped", role: "viewer", scopes: [] }, "other", false, "profileMissing"),
  authCase("token-with-scope", { binding: "planningToken", role: "deputy", scopes: [reviseScope] }, "other", true, "scope"),
  authCase("token-without-scope", { binding: "planningToken", role: "deputy", scopes: [] }, "other", false, "scopeMissing"),
];
