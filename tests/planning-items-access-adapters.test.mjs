import assert from "node:assert/strict";

import test from "node:test";

import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const contract = await loadTranspiledModule(
  "src/features/planning-items/model/planning-items-contract.ts",
);

const basePermission = {
  ok: true,
  supabase: {},
  profile: { id: "profile-1", platformRole: "ceo" },
  tokenId: "token-1",
  tokenHint: "…a8F31x",
  scopes: ["read:planning-context", "write:planning-items:create"],
  scopeGranted: true,
  expiresAt: "2026-09-03T10:00:00Z",
  evaluatedAt: "2026-08-19T10:00:00Z",
  remainingSeconds: 1_296_000,
};

async function captureAdapterAccess(path, exportName, mocks, request = {}) {
  let captured;
  const route = await loadTranspiledModule(path, {
    ...mocks,
    "@/features/planning-items/model/planning-items-route": {
      handlePlanningItemsRequest: async (_request, accessRequest) => {
        const additionalScopes = accessRequest.resolveAdditionalScopes
          ? await accessRequest.resolveAdditionalScopes(basePermission)
          : [];
        captured = {
          operation: accessRequest.operation,
          mode: accessRequest.mode,
          requiredScopes: [...accessRequest.requiredScopes, ...additionalScopes],
        };
        return captured;
      },
      planningItemsError: () => null,
      planningItemsJson: () => null,
      planningItemsTokenInactiveError: () => null,
    },
  });
  await route[exportName](request, { params: Promise.resolve({ id: "item-1" }) });
  return captured;
}

test("Planning route adapters publish stable operation, mode, and scope metadata", async () => {
  const nextServer = { after: () => undefined };
  const actorContext = { actorContextFromPlanningTokenAuth: () => ({ ok: false }) };
  const canonicalItem = { hasCanonicalTeamPlanningItem: async () => true };
  const apiInput = { auditRequestMetadata: () => ({}) };
  const createModel = {
    createTeamCreatePlanningItems: () => ({ run: async () => ({ ok: false }) }),
    parsePlanningItemCreatePayload: () => ({ ok: true, items: [], githubSyncMode: "async" }),
    planningCreateError: () => ({}),
    planningCreateTokenBecameInactive: () => false,
    planningCreateTransactionFromResult: () => null,
    planningItemCreateCommand: () => ({}),
    planningItemCreateRequiresOperationalLead: () => false,
  };
  const updateModel = {
    buildPlanningItemUpdatePreview: async () => ({ ok: false }),
    createTeamRevisePlanningItems: () => ({ run: async () => ({ ok: false }) }),
    mapPlanningItemDatabaseRow: () => ({}),
    parsePlanningItemPatchPayload: () => ({ ok: true, githubSyncMode: "async" }),
    planningItemUpdateHash: () => "hash",
    planningItemReviseCommand: () => ({}),
    teamReviseTransactionFromResult: () => null,
  };
  const deleteModel = {
    createEmptyEpicDeletePlanningItems: () => ({ run: async () => ({ ok: false }) }),
    emptyEpicDeleteCommand: () => ({}),
    emptyEpicDeleteError: () => ({}),
    emptyEpicDeletePreview: () => null,
    emptyEpicDeleteTeamItem: () => null,
    parseEmptyEpicDeletePayload: () => ({ ok: true }),
  };
  const reparentModel = {
    changePlanningParentCommand: () => ({}),
    createPlanningReparentPlanningItems: () => ({ run: async () => ({ ok: false }) }),
    planningReparentError: () => ({}),
    planningReparentHash: () => "hash",
  };
  const githubProjection = {
    dispatchAndLoadPlanningGitHubProjections: async () => new Map(),
    enqueueTeamPlanningGitHubProjection: async () => ({ ok: false }),
  };
  const request = { json: async () => ({}) };

  const context = await captureAdapterAccess(
    "src/features/planning-items/model/planning-items-team-context-route.ts",
    "handleTeamPlanningItemsContext",
    { "@/features/planning-items/model/planning-items-context": { buildPlanningItemsContext: async () => ({}) } },
    request,
  );
  const createPreview = await captureAdapterAccess(
    "src/features/planning-items/model/planning-items-team-create-route.ts",
    "handleTeamPlanningItemsCreatePreview",
    {
      "next/server": nextServer,
      "@/lib/api-input": apiInput,
      "@/features/planning-items/model/planning-actor-context-server": actorContext,
      "@/features/planning-items/model/planning-items-contract": { isUuid: () => true },
      "@/features/planning-items/model/planning-items-create": createModel,
      "@/features/planning-items/model/planning-items-github-projection": githubProjection,
    },
    request,
  );
  const createCommit = await captureAdapterAccess(
    "src/features/planning-items/model/planning-items-team-create-route.ts",
    "handleTeamPlanningItemsCreate",
    {
      "next/server": nextServer,
      "@/lib/api-input": apiInput,
      "@/features/planning-items/model/planning-actor-context-server": actorContext,
      "@/features/planning-items/model/planning-items-contract": { isUuid: () => true },
      "@/features/planning-items/model/planning-items-create": createModel,
      "@/features/planning-items/model/planning-items-github-projection": githubProjection,
    },
    request,
  );
  const updatePreview = await captureAdapterAccess(
    "src/features/planning-items/model/planning-items-team-update-preview.ts",
    "handleTeamPlanningItemUpdatePreview",
    {
      "@/features/planning-items/model/planning-item-update": updateModel,
      "@/features/planning-items/model/planning-actor-context-server": actorContext,
      "@/features/planning-items/model/planning-items-github-sync-preview": { previewPlanningItemGitHubSync: () => ({}) },
      "@/features/planning-items/model/planning-items-contract": { isStrategicPlanningItemType: () => false },
    },
    request,
  );
  const updateCommit = await captureAdapterAccess(
    "src/features/planning-items/model/planning-items-team-update-route.ts",
    "handleTeamPlanningItemUpdate",
    {
      "next/server": nextServer,
      "@/lib/api-input": apiInput,
      "@/features/planning-items/model/planning-items-contract": { isUuid: () => true },
      "@/features/planning-items/model/planning-actor-context-server": actorContext,
      "@/features/planning-items/model/planning-items-empty-epic-delete": deleteModel,
      "@/features/planning-items/model/planning-items-reparent": reparentModel,
      "@/features/planning-items/model/planning-item-update": updateModel,
      "@/features/planning-items/model/planning-items-github-projection": githubProjection,
      "@/features/planning-items/model/planning-items-team-canonical-item": canonicalItem,
    },
    request,
  );
  const deletePreview = await captureAdapterAccess(
    "src/features/planning-items/model/planning-items-team-delete-preview-route.ts",
    "handleTeamPlanningItemDeletePreview",
    {
      "@/features/planning-items/model/planning-actor-context-server": actorContext,
      "@/features/planning-items/model/planning-items-empty-epic-delete": deleteModel,
      "@/features/planning-items/model/planning-items-team-canonical-item": canonicalItem,
    },
    request,
  );
  const deleteCommit = await captureAdapterAccess(
    "src/features/planning-items/model/planning-items-team-update-route.ts",
    "handleTeamPlanningItemDelete",
    {
      "next/server": nextServer,
      "@/lib/api-input": apiInput,
      "@/features/planning-items/model/planning-items-contract": { isUuid: () => true },
      "@/features/planning-items/model/planning-actor-context-server": actorContext,
      "@/features/planning-items/model/planning-items-empty-epic-delete": deleteModel,
      "@/features/planning-items/model/planning-items-reparent": reparentModel,
      "@/features/planning-items/model/planning-item-update": updateModel,
      "@/features/planning-items/model/planning-items-github-projection": githubProjection,
      "@/features/planning-items/model/planning-items-team-canonical-item": canonicalItem,
    },
    request,
  );
  const githubSync = await captureAdapterAccess(
    "src/features/planning-items/model/planning-items-team-github-sync-route.ts",
    "handleTeamPlanningItemGitHubSync",
    {
      "next/server": nextServer,
      "@/features/planning-items/model/planning-items-contract": contract,
      "@/features/planning-items/model/planning-items-github-projection": githubProjection,
      "@/features/planning-items/model/planning-items-team-canonical-item": canonicalItem,
      "@/lib/github-sync/contract": {
        taskGitHubSyncFailure: () => ({}),
        taskGitHubSyncHttpStatus: () => 500,
      },
    },
    request,
  );

  assert.deepEqual([
    context,
    createPreview,
    createCommit,
    updatePreview,
    updateCommit,
    deletePreview,
    deleteCommit,
    githubSync,
  ], [
    { operation: "planningContext.read", mode: "read", requiredScopes: ["read:planning-context"] },
    { operation: "planningItems.create", mode: "preview", requiredScopes: ["write:planning-items:create", "write:planning-items:github-sync"] },
    { operation: "planningItems.create", mode: "commit", requiredScopes: ["write:planning-items:create", "write:planning-items:github-sync"] },
    { operation: "planningItems.update", mode: "preview", requiredScopes: ["write:planning-items:update", "write:planning-items:github-sync"] },
    { operation: "planningItems.update", mode: "commit", requiredScopes: ["write:planning-items:update", "write:planning-items:github-sync"] },
    { operation: "planningItems.deleteEmpty", mode: "preview", requiredScopes: ["write:planning-items:delete-empty"] },
    { operation: "planningItems.deleteEmpty", mode: "commit", requiredScopes: ["write:planning-items:delete-empty"] },
    { operation: "planningItems.githubSync", mode: "commit", requiredScopes: ["write:planning-items:github-sync"] },
  ]);
});
