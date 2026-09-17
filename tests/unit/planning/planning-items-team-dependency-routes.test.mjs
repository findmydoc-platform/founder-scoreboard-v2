import assert from "node:assert/strict";
import { test } from "vitest";

import { importTestModule } from "../../helpers/vitest-module.mjs";

const expectedUpdatedAt = "2026-09-12T10:00:00.000Z";
const dependency = {
  operation: "add",
  direction: "blocked_by",
  relatedItemId: "blocker",
  note: "Waiting for approval",
};
const parsed = {
  ok: true,
  expectedUpdatedAt,
  presentFields: [],
  raw: { expectedUpdatedAt, dependency },
  dependency,
  githubSync: null,
  githubSyncMode: null,
};
const preview = {
  itemId: "blocked",
  itemType: "deliverable",
  expectedUpdatedAt,
  currentItem: { id: "blocked", title: "Blocked" },
  normalizedPatch: { dependency },
  resultingItem: { id: "blocked", title: "Blocked" },
  changedFields: ["dependencies"],
  systemEffects: [],
  dependencyChange: {
    operation: "add",
    changed: true,
    relationship: {
      relationshipId: 41,
      blockedItemId: "blocked",
      blockingItemId: "blocker",
      note: "Waiting for approval",
    },
  },
  warnings: [],
  errors: [],
};

function queryResult(data = null) {
  const query = {
    select() { return query; },
    eq() { return query; },
    async maybeSingle() { return { data, error: null }; },
  };
  return query;
}

function commonMocks(dependencyModel, supabase = { from: () => queryResult() }, parsedPayload = parsed) {
  return {
    "next/server": { after: () => undefined },
    "@/lib/api-input": { auditRequestMetadata: () => ({ request_ip: "test-ip", user_agent: "test-agent" }) },
    "@/features/planning-items/model/planning-actor-context-server": {
      actorContextFromPlanningTokenAuth: () => ({
        ok: true,
        actor: {
          profileId: "ceo",
          platformRole: "ceo",
          credential: { kind: "planningToken", tokenId: "token-one", scopes: ["write:planning-items:update"] },
        },
      }),
    },
    "@/features/planning-items/model/planning-items-route": {
      handlePlanningItemsRequest: async (_request, _access, _message, handler) => handler({
        supabase,
        profile: { id: "ceo", platformRole: "ceo" },
        tokenId: "token-one",
        scopes: ["write:planning-items:update"],
      }),
      planningItemsError: (error, status) => ({ body: { ok: false, error }, status }),
      planningItemsJson: (body, status = 200) => ({ body, status }),
      planningItemsTokenInactiveError: () => ({ body: { ok: false, code: "TOKEN_INACTIVE" }, status: 401 }),
    },
    "@/features/planning-items/model/planning-items-contract": {
      isStrategicPlanningItemType: () => false,
      isUuid: () => true,
    },
    "@/features/planning-items/model/planning-item-update": {
      buildPlanningItemUpdatePreview: async () => ({ ok: false }),
      createTeamRevisePlanningItems: () => ({ run: async () => ({ ok: false }) }),
      mapPlanningItemDatabaseRow: (_itemType, item) => item,
      parsePlanningItemPatchPayload: () => parsedPayload,
      planningItemUpdateHash: () => "a".repeat(64),
      planningItemReviseCommand: () => ({}),
      teamReviseTransactionFromResult: () => null,
    },
    "@/features/planning-items/model/planning-items-team-dependency": {
      planningDependencyUpdateHash: () => "d".repeat(64),
      ...dependencyModel,
    },
  };
}

test("context route exposes the canonical root dependency list", async () => {
  const dependencies = [{
    relationshipId: 41,
    blockedItemId: "blocked",
    blockingItemId: "blocker",
    note: "Waiting for approval",
  }];
  const route = await importTestModule(
    "src/features/planning-items/model/planning-items-team-context-route.ts",
    {
      "@/features/planning-items/model/planning-items-context": {
        buildPlanningItemsContext: async () => ({ items: [], dependencies }),
      },
      "@/features/planning-items/model/planning-items-route": {
        handlePlanningItemsRequest: async (_request, _access, _message, handler) => handler({
          supabase: {},
          profile: { id: "ceo", platformRole: "ceo" },
        }),
        planningItemsJson: (body) => ({ body, status: 200 }),
      },
    },
  );

  const response = await route.handleTeamPlanningItemsContext({});
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.context.dependencies, dependencies);
});

test("dependency preview stays on the existing update preview route", async () => {
  const calls = [];
  const route = await importTestModule(
    "src/features/planning-items/model/planning-items-team-update-preview.ts",
    {
      ...commonMocks({
        buildTeamPlanningDependencyPreview: async (input) => {
          calls.push(input);
          return { ok: true, preview };
        },
      }),
      "@/features/planning-items/model/planning-items-github-sync-preview": { previewPlanningItemGitHubSync: () => ({}) },
    },
  );
  const response = await route.handleTeamPlanningItemUpdatePreview(
    { json: async () => parsed.raw },
    { params: Promise.resolve({ id: "blocked" }) },
  );

  assert.equal(response.status, 200);
  assert.equal(response.body.valid, true);
  assert.deepEqual(response.body.dependencyChange, preview.dependencyChange);
  assert.equal(calls[0].dependency.direction, "blocked_by");
});

test("dependency commit uses the update receipt and returns the dependency change", async () => {
  const calls = [];
  const transaction = {
    commandKind: "dependency",
    replayed: false,
    itemType: "deliverable",
    item: { id: "blocked", title: "Blocked" },
    changedFields: ["dependencies"],
    systemEffects: [],
    dependencyChange: preview.dependencyChange,
  };
  const route = await importTestModule(
    "src/features/planning-items/model/planning-items-team-update-route.ts",
    {
      ...commonMocks({
        buildTeamPlanningDependencyPreview: async () => {
          throw new Error("commit must not preflight mutable dependency state");
        },
        commitTeamPlanningDependency: async (input) => {
          calls.push(input);
          return { ok: true, transaction };
        },
      }),
      "@/features/planning-items/model/planning-items-empty-epic-delete": {},
      "@/features/planning-items/model/planning-items-reparent": {},
      "@/features/planning-items/model/planning-items-github-projection": { dispatchAndLoadPlanningGitHubProjections: async () => new Map() },
      "@/features/planning-items/model/planning-items-team-canonical-item": { hasCanonicalTeamPlanningItem: async () => true },
    },
  );
  const response = await route.handleTeamPlanningItemUpdate(
    {
      json: async () => parsed.raw,
      headers: { get: () => "00000000-0000-4000-8000-000000000302" },
      nextUrl: { origin: "https://example.test" },
    },
    { params: Promise.resolve({ id: "blocked" }) },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.body.dependencyChange, preview.dependencyChange);
  assert.equal(calls[0].requestHash, "d".repeat(64));
  assert.equal(calls[0].idempotencyKey, "00000000-0000-4000-8000-000000000302");
});

test("dependency removal previews and commits through the same update routes", async () => {
  const removeDependency = { operation: "remove", relationshipId: 41 };
  const removeParsed = {
    ...parsed,
    raw: { expectedUpdatedAt, dependency: removeDependency },
    dependency: removeDependency,
  };
  const removeChange = {
    operation: "remove",
    changed: true,
    relationship: preview.dependencyChange.relationship,
  };
  const removePreview = {
    ...preview,
    normalizedPatch: { dependency: removeDependency },
    dependencyChange: removeChange,
  };
  const calls = [];
  const dependencyModel = {
    buildTeamPlanningDependencyPreview: async (input) => {
      calls.push(["preview", input]);
      return { ok: true, preview: removePreview };
    },
    commitTeamPlanningDependency: async (input) => {
      calls.push(["commit", input]);
      return {
        ok: true,
        transaction: {
          commandKind: "dependency",
          replayed: false,
          itemType: "deliverable",
          item: { id: "blocked", title: "Blocked" },
          changedFields: ["dependencies"],
          systemEffects: [],
          dependencyChange: removeChange,
        },
      };
    },
  };
  const previewRoute = await importTestModule(
    "src/features/planning-items/model/planning-items-team-update-preview.ts",
    {
      ...commonMocks(dependencyModel, undefined, removeParsed),
      "@/features/planning-items/model/planning-items-github-sync-preview": { previewPlanningItemGitHubSync: () => ({}) },
    },
  );
  const previewResponse = await previewRoute.handleTeamPlanningItemUpdatePreview(
    { json: async () => removeParsed.raw },
    { params: Promise.resolve({ id: "blocked" }) },
  );
  assert.deepEqual(previewResponse.body.dependencyChange, removeChange);

  const commitRoute = await importTestModule(
    "src/features/planning-items/model/planning-items-team-update-route.ts",
    {
      ...commonMocks(dependencyModel, undefined, removeParsed),
      "@/features/planning-items/model/planning-items-empty-epic-delete": {},
      "@/features/planning-items/model/planning-items-reparent": {},
      "@/features/planning-items/model/planning-items-github-projection": { dispatchAndLoadPlanningGitHubProjections: async () => new Map() },
      "@/features/planning-items/model/planning-items-team-canonical-item": { hasCanonicalTeamPlanningItem: async () => true },
    },
  );
  const commitResponse = await commitRoute.handleTeamPlanningItemUpdate(
    {
      json: async () => removeParsed.raw,
      headers: { get: () => "00000000-0000-4000-8000-000000000302" },
      nextUrl: { origin: "https://example.test" },
    },
    { params: Promise.resolve({ id: "blocked" }) },
  );
  assert.deepEqual(commitResponse.body.dependencyChange, removeChange);
  assert.equal(calls.filter(([kind]) => kind === "preview").length, 1);
  assert.equal(calls.filter(([kind]) => kind === "commit").length, 1);
  assert.equal(calls.at(-1)[1].dependency.relationshipId, 41);
});

test("late review-evidence conflicts remain actionable on the update route", async () => {
  const parsedReview = {
    ok: true,
    expectedUpdatedAt,
    presentFields: ["status", "evidenceExceptionNote"],
    raw: { expectedUpdatedAt, status: "Review", evidenceExceptionNote: "Accepted without a link." },
    dependency: null,
    githubSync: null,
    githubSyncMode: null,
  };
  const reviewPreview = {
    ...preview,
    normalizedPatch: parsedReview.raw,
    resultingItem: { id: "blocked", status: "Review" },
    changedFields: ["status", "evidenceExceptionNote"],
    dependencyChange: undefined,
  };
  const mocks = commonMocks({}, undefined, parsedReview);
  mocks["@/features/planning-items/model/planning-item-update"] = {
    buildPlanningItemUpdatePreview: async () => ({ ok: true, preview: reviewPreview }),
    createTeamRevisePlanningItems: () => ({
      run: async () => ({
        ok: false,
        error: {
          code: "conflict",
          reason: "state",
          details: { planningReviewReason: "evidenceRequired" },
        },
      }),
    }),
    mapPlanningItemDatabaseRow: (_itemType, item) => item,
    parsePlanningItemPatchPayload: () => parsedReview,
    planningItemUpdateHash: () => "a".repeat(64),
    planningItemReviseCommand: () => ({}),
    teamReviseTransactionFromResult: () => null,
  };
  const route = await importTestModule(
    "src/features/planning-items/model/planning-items-team-update-route.ts",
    {
      ...mocks,
      "@/features/planning-items/model/planning-items-empty-epic-delete": {},
      "@/features/planning-items/model/planning-items-reparent": {},
      "@/features/planning-items/model/planning-items-github-projection": { dispatchAndLoadPlanningGitHubProjections: async () => new Map() },
      "@/features/planning-items/model/planning-items-team-canonical-item": { hasCanonicalTeamPlanningItem: async () => true },
    },
  );
  const response = await route.handleTeamPlanningItemUpdate(
    {
      json: async () => parsedReview.raw,
      headers: { get: () => "00000000-0000-4000-8000-000000000309" },
      nextUrl: { origin: "https://example.test" },
    },
    { params: Promise.resolve({ id: "blocked" }) },
  );
  assert.equal(response.status, 409);
  assert.match(response.body.error, /Evidence-Link/);
});
