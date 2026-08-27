import assert from "node:assert/strict";

import test from "node:test";

import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const contract = await loadTranspiledModule(
  "src/features/planning-items/model/planning-items-contract.ts",
);
const deliverableSchedule = await loadTranspiledModule(
  "src/features/planning-items/model/deliverable-schedule.ts",
);

const create = await loadTranspiledModule(
  "src/features/planning-items/model/planning-items-create.ts",
  {
    "@/lib/planning-read-model": {
      ACTIVE_PACKAGES_TABLE: "active_packages",
      ACTIVE_TASKS_TABLE: "active_tasks",
    },
    "@/lib/github-repositories": {
      defaultGitHubRepository: "findmydoc-platform/management",
      resolveTaskGitHubRepository: () => ({
        ok: true,
        repository: "findmydoc-platform/management",
      }),
    },
    "@/features/reviews/model/task-review-state": {},
    "@/features/planning-items/model/planning-items-contract": contract,
    "@/features/planning-items/model/planning-items-github-sync-preview": {
      previewPlanningItemGitHubSync: () => ({ status: "accepted" }),
    },
    "@/features/planning-items/model/planning-item-normalization": {
      intakeText: (value) => String(value || "").trim(),
    },
    "@/features/planning-items/model/deliverable-schedule": deliverableSchedule,
  },
);

const update = await loadTranspiledModule(
  "src/features/planning-items/model/planning-item-update.ts",
  {
    "@/lib/planning-read-model": {
      ACTIVE_PACKAGES_TABLE: "active_packages",
      ACTIVE_TASKS_TABLE: "active_tasks",
    },
    "@/lib/github-repositories": {},
    "@/features/tasks/model/task-detail-permissions": {},
    "@/features/reviews/model/task-review-state": {},
    "@/features/tasks/model/task-route-update-helpers": {},
    "@/lib/platform": {},
    "@/lib/status": {},
    "@/features/planning-items/model/planning-items-contract": contract,
    "@/features/planning-items/model/planning-item-normalization": {},
    "@/features/planning-items/model/deliverable-schedule": deliverableSchedule,
  },
);

test("GitHub sync command and mode parsing are strict", () => {
  assert.deepEqual(
    contract.parsePlanningItemGitHubSyncCommand({ createIfMissing: false }),
    { ok: true, command: { createIfMissing: false } },
  );
  assert.equal(
    contract.parsePlanningItemGitHubSyncCommand({ createIfMissing: "false" }).ok,
    false,
  );
  assert.equal(
    contract.parsePlanningItemGitHubSyncCommand({
      createIfMissing: true,
      unexpected: true,
    }).ok,
    false,
  );
  assert.equal(contract.parsePlanningItemGitHubSyncMode("async"), "async");
  assert.equal(contract.parsePlanningItemGitHubSyncMode("wait"), "wait");
  assert.equal(contract.parsePlanningItemGitHubSyncMode("later"), null);
});

test("create requires an explicit mode exactly when an item requests GitHub sync", () => {
  const baseItem = { itemType: "sub_issue", title: "Sync item" };
  assert.equal(create.parsePlanningItemCreatePayload({
    items: [{ ...baseItem, githubSync: { createIfMissing: true } }],
  }).ok, false);
  assert.equal(create.parsePlanningItemCreatePayload({
    githubSyncMode: "async",
    items: [baseItem],
  }).ok, false);

  const parsed = create.parsePlanningItemCreatePayload({
    githubSyncMode: "wait",
    items: [
      { ...baseItem, githubSync: { createIfMissing: false } },
      { itemType: "deliverable", title: "FounderOps only" },
    ],
  });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.githubSyncMode, "wait");
  assert.deepEqual(create.planningItemCreateGitHubSyncCommands(parsed.items), [
    { createIfMissing: false },
    null,
  ]);
});

test("PATCH permits sync-only commands and keeps mode-command coupling strict", () => {
  const expectedUpdatedAt = "2026-07-28T12:00:00.000Z";
  const parsed = update.parsePlanningItemPatchPayload({
    expectedUpdatedAt,
    githubSyncMode: "async",
    githubSync: { createIfMissing: true },
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.presentFields, []);
  assert.deepEqual(parsed.githubSync, { createIfMissing: true });

  assert.equal(update.parsePlanningItemPatchPayload({
    expectedUpdatedAt,
    githubSync: { createIfMissing: true },
  }).ok, false);
  assert.equal(update.parsePlanningItemPatchPayload({
    expectedUpdatedAt,
    githubSyncMode: "wait",
    title: "No command",
  }).ok, false);

  const unknownField = update.parsePlanningItemPatchPayload({
    expectedUpdatedAt,
    unsupportedField: "value",
  });
  assert.equal(unknownField.ok, false);
  assert.match(unknownField.error, /unbekannte Feld unsupportedField/);

  assert.equal(update.parsePlanningItemPatchPayload({ expectedUpdatedAt, sprintId: "sprint-1" }).ok, false);
  assert.equal(update.parsePlanningItemPatchPayload({ expectedUpdatedAt, evidenceLink: "https://example.com" }).ok, false);
  const internal = update.parsePlanningItemPatchPayload(
    { expectedUpdatedAt, sprintId: "sprint-1", evidenceLink: "https://example.com" },
    { allowWebhookProjectionFields: true },
  );
  assert.equal(internal.ok, true);
  assert.deepEqual(internal.presentFields, ["sprintId", "evidenceLink"]);
});

test("create idempotency hash includes GitHub mode and per-item decisions", () => {
  const items = [{
    clientId: "planning-items-create-1",
    itemType: "sub_issue",
    title: "Sync item",
    description: "",
    approvalStatus: null,
    errors: [],
    warnings: [],
  }];
  const asyncHash = create.planningItemCreateHash(
    items,
    "async",
    [{ createIfMissing: true }],
  );
  const waitHash = create.planningItemCreateHash(
    items,
    "wait",
    [{ createIfMissing: true }],
  );
  const noCreateHash = create.planningItemCreateHash(
    items,
    "async",
    [{ createIfMissing: false }],
  );
  assert.notEqual(asyncHash, waitHash);
  assert.notEqual(asyncHash, noCreateHash);
});
