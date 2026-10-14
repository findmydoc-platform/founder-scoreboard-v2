import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";

const expectedUpdatedAt = "2026-09-12T10:00:00.000Z";
const idempotencyKey = "00000000-0000-4000-8000-000000000302";
const updateHash = "a".repeat(64);
const parentHash = "p".repeat(64);
const dependencyHash = "d".repeat(64);
const operationId = `team-update:token-one:${idempotencyKey}`;
const sync = { createIfMissing: false };

function parsedUpdate(overrides = {}) {
  const githubSyncMode = overrides.githubSyncMode ?? "wait";
  return {
    ok: true,
    expectedUpdatedAt,
    presentFields: ["title"],
    raw: { expectedUpdatedAt, title: "Updated", githubSync: sync, githubSyncMode },
    dependency: null,
    githubSync: sync,
    githubSyncMode,
    ...overrides,
  };
}

function transaction(overrides = {}) {
  return {
    itemType: "deliverable",
    item: { id: "item-one", title: "Updated" },
    changedFields: ["title"],
    systemEffects: [],
    githubSync: { status: "accepted", operationId },
    ...overrides,
  };
}

function receipt(overrides = {}) {
  return { request_hash: updateHash, contract_version: 3, response: transaction(), ...overrides };
}

async function fixture({ stored = receipt(), parsed = parsedUpdate(), role = "ceo", previewError, receiptAfterPreview, commitError, projectionFailures = 0 } = {}) {
  vi.resetModules();
  const calls = [];
  const writes = [];
  const scheduled = [];
  let currentReceipt = stored;
  const saved = transaction({ projectionOperationId: operationId });
  const actor = {
    profileId: "profile-one",
    platformRole: role,
    credential: { kind: "planningToken", tokenId: "token-one", scopes: ["write:planning-items:update", "write:planning-items:github-sync"] },
  };
  const query = {
    select() { return query; },
    eq() { return query; },
    async maybeSingle() { return { data: currentReceipt, error: null }; },
  };
  const supabase = { from: () => query };
  const route = await importTestModule("src/features/planning-items/model/planning-items-team-update-route.ts", {
    "next/server": { after: (callback) => scheduled.push(callback) },
    "@/lib/api-input": { auditRequestMetadata: () => ({ user_agent: "test-agent" }) },
    "@/features/planning-items/model/planning-actor-context-server": {
      actorContextFromPlanningTokenAuth: () => ({ ok: true, actor }),
    },
    "@/features/planning-items/model/planning-items-contract": { isUuid: () => true },
    "@/features/planning-items/model/planning-items-route": {
      handlePlanningItemsRequest: async (_request, _access, _message, handler) => {
        try {
          return await handler({ supabase, profile: { id: actor.profileId, platformRole: role }, tokenId: "token-one", scopes: actor.credential.scopes });
        } catch {
          return { status: 500, body: { ok: false } };
        }
      },
      planningItemsError: (error, status, options = {}) => ({ body: { ok: false, error, ...options }, status }),
      planningItemsJson: (body, status = 200) => ({ body, status }),
      planningItemsTokenInactiveError: () => ({ body: { ok: false, code: "TOKEN_INACTIVE" }, status: 401 }),
    },
    "@/features/planning-items/model/planning-item-update": {
      parsePlanningItemPatchPayload: () => parsed,
      planningItemUpdateHash: () => updateHash,
      mapPlanningItemDatabaseRow: (_type, item) => item,
      buildPlanningItemUpdatePreview: async () => {
        if (receiptAfterPreview) currentReceipt = receiptAfterPreview;
        return previewError || {
          ok: true,
          preview: { itemId: "item-one", itemType: "deliverable", changedFields: ["title"], systemEffects: [], warnings: [], errors: [] },
        };
      },
      planningItemReviseCommand: () => ({ kind: "reviseItem" }),
      createTeamRevisePlanningItems: () => ({
        run: async () => {
          writes.push("revise");
          if (commitError) return commitError;
          currentReceipt = receipt({ response: saved });
          return { ok: true, status: "committed", replayed: false, changes: [{ after: saved }] };
        },
      }),
      teamReviseTransactionFromResult: (result) => result.changes[0].after,
    },
    "@/features/planning-items/model/planning-items-reparent": {
      planningReparentHash: () => parentHash,
      changePlanningParentCommand: () => ({ kind: "changeParent" }),
      createPlanningReparentPlanningItems: () => ({
        run: async () => {
          writes.push("changeParent");
          currentReceipt = receipt({ request_hash: parentHash, contract_version: 2, response: transaction({ commandKind: "changeParent" }) });
          return commitError || { ok: true, status: "committed", replayed: false };
        },
      }),
      planningReparentError: () => ({ message: "Parent changed", status: 409 }),
    },
    "@/features/planning-items/model/planning-items-team-dependency": {
      planningDependencyUpdateHash: () => dependencyHash,
      commitTeamPlanningDependency: async () => {
        writes.push("dependency");
        return { ok: true, transaction: transaction({ commandKind: "dependency", githubSync: undefined }) };
      },
    },
    "@/features/planning-items/model/planning-items-github-projection": {
      dispatchAndLoadPlanningGitHubProjections: async (_supabase, requestedOperationId) => {
        calls.push(["dispatch", requestedOperationId]);
        if (projectionFailures > 0) {
          projectionFailures -= 1;
          throw new Error("GitHub unavailable");
        }
        const projected = { status: "synced", operationId: requestedOperationId };
        if (currentReceipt) currentReceipt = { ...currentReceipt, response: { ...currentReceipt.response, githubSync: projected } };
        return new Map([["item-one", projected]]);
      },
    },
    "@/features/planning-items/model/planning-items-empty-epic-delete": {},
    "@/features/planning-items/model/planning-items-team-canonical-item": {},
  });
  return {
    calls,
    writes,
    scheduled,
    request: () => route.handleTeamPlanningItemUpdate({
      json: async () => parsed.raw,
      headers: { get: () => idempotencyKey },
      nextUrl: { origin: "https://example.test" },
    }, { params: Promise.resolve({ id: "item-one" }) }),
  };
}

for (const [name, stored, role, status] of [
  ["mismatched input", receipt({ request_hash: "wrong-hash" }), "ceo", 409],
  ["retired response contract", receipt({ contract_version: 1 }), "ceo", 409],
  ["another item", receipt({ response: transaction({ item: { id: "other-item" } }) }), "ceo", 404],
  ["an Epic for a founder", receipt({ response: transaction({ itemType: "epic" }) }), "founder", 403],
  ["an incomplete receipt", receipt({ response: null }), "ceo", 500],
]) {
  test(`wait replay rejects ${name} before any GitHub processing`, async () => {
    const current = await fixture({ stored, role });
    const response = await current.request();
    assert.equal(response.status, status);
    assert.equal(response.body.ok, false);
    assert.deepEqual(current.calls, []);
    assert.deepEqual(current.writes, []);
    assert.deepEqual(current.scheduled, []);
  });
}

test("valid wait replay returns the stored item with refreshed projection status", async () => {
  const current = await fixture();
  const response = await current.request();
  assert.equal(response.status, 200);
  assert.equal(response.body.replayed, true);
  assert.deepEqual(response.body.item, { id: "item-one", title: "Updated" });
  assert.equal(response.body.githubSync.status, "synced");
  assert.equal(response.body.itemLink, "https://example.test/tasks/item-one");
  assert.deepEqual(current.calls, [["dispatch", operationId]]);
  assert.deepEqual(current.writes, []);
});

test("version 2 parent-change receipts remain replayable without another commit", async () => {
  const parsed = parsedUpdate({
    raw: { expectedUpdatedAt, parentTaskId: "parent-one", githubSync: sync, githubSyncMode: "wait" },
    presentFields: ["parentTaskId"],
  });
  const current = await fixture({
    parsed,
    stored: receipt({ contract_version: 2, request_hash: parentHash, response: transaction({ commandKind: "changeParent" }) }),
  });
  const response = await current.request();
  assert.equal(response.status, 200);
  assert.equal(response.body.replayed, true);
  assert.deepEqual(current.calls, [["dispatch", operationId]]);
  assert.deepEqual(current.writes, []);
});

test("async replay returns its receipt without scheduling another projection", async () => {
  const current = await fixture({ parsed: parsedUpdate({ githubSyncMode: "async" }) });
  const response = await current.request();
  assert.equal(response.status, 200);
  assert.equal(response.body.replayed, true);
  assert.equal(response.body.githubSync.status, "accepted");
  assert.deepEqual(current.calls, []);
  assert.deepEqual(current.writes, []);
  assert.deepEqual(current.scheduled, []);
});

test("new revision commits once then processes its durable projection", async () => {
  const current = await fixture({ stored: null });
  const response = await current.request();
  assert.equal(response.status, 200);
  assert.equal(response.body.replayed, false);
  assert.equal(response.body.githubSync.status, "synced");
  assert.deepEqual(current.calls, [["dispatch", operationId]]);
  assert.deepEqual(current.writes, ["revise"]);
});

test("new async revision schedules projection processing after commit", async () => {
  const current = await fixture({ stored: null, parsed: parsedUpdate({ githubSyncMode: "async" }) });
  const response = await current.request();
  assert.equal(response.status, 200);
  assert.equal(response.body.githubSync.status, "accepted");
  assert.deepEqual(current.calls, []);
  assert.deepEqual(current.writes, ["revise"]);
  assert.equal(current.scheduled.length, 1);
  await current.scheduled[0]();
  assert.deepEqual(current.calls.at(-1), ["dispatch", operationId]);
});

test("new parent change reloads its receipt before processing projection", async () => {
  const current = await fixture({ stored: null, parsed: parsedUpdate({
    raw: { expectedUpdatedAt, parentTaskId: "parent-one", githubSync: sync, githubSyncMode: "wait" },
    presentFields: ["parentTaskId"],
  }) });
  const response = await current.request();
  assert.equal(response.status, 200);
  assert.equal(response.body.replayed, false);
  assert.equal(response.body.githubSync.status, "synced");
  assert.deepEqual(current.calls, [["dispatch", operationId]]);
  assert.deepEqual(current.writes, ["changeParent"]);
});

test("late token revocation rejects a fresh revision without processing GitHub", async () => {
  const current = await fixture({ stored: null, commitError: { ok: false, error: { code: "forbidden", reason: "planningTokenInactive" } } });
  const response = await current.request();
  assert.equal(response.status, 401);
  assert.equal(response.body.code, "TOKEN_INACTIVE");
  assert.deepEqual(current.calls, []);
  assert.deepEqual(current.writes, ["revise"]);
});

test("version 2 revision receipts keep their existing replay compatibility", async () => {
  const current = await fixture({ stored: receipt({ contract_version: 2 }) });
  const response = await current.request();
  assert.equal(response.status, 200);
  assert.equal(response.body.replayed, true);
  assert.deepEqual(current.writes, []);
});

test("a concurrent successful commit is replayed when preview observes its new revision", async () => {
  const current = await fixture({
    stored: null,
    previewError: { ok: false, status: 409, error: "Changed concurrently" },
    receiptAfterPreview: receipt(),
  });
  const response = await current.request();
  assert.equal(response.status, 200);
  assert.equal(response.body.replayed, true);
  assert.equal(response.body.githubSync.status, "synced");
  assert.deepEqual(current.writes, []);
});

test("a conflicting concurrent receipt is rejected without GitHub processing", async () => {
  const current = await fixture({
    stored: null,
    previewError: { ok: false, status: 409, error: "Changed concurrently" },
    receiptAfterPreview: receipt({ request_hash: "different-request" }),
  });
  const response = await current.request();
  assert.equal(response.status, 409);
  assert.deepEqual(current.writes, []);
  assert.deepEqual(current.calls, []);
});

test("retry after GitHub failure reuses the committed revision and durable projection", async () => {
  const current = await fixture({ stored: null, projectionFailures: 1 });
  const failed = await current.request();
  assert.equal(failed.status, 500);
  const replayed = await current.request();
  assert.equal(replayed.status, 200);
  assert.equal(replayed.body.replayed, true);
  assert.equal(replayed.body.githubSync.status, "synced");
  assert.deepEqual(current.writes, ["revise"]);
  assert.deepEqual(current.calls, [["dispatch", operationId], ["dispatch", operationId]]);
});
