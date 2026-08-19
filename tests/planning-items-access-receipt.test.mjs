import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";
import { readSupabaseMigrationCorpus } from "../scripts/lib/supabase-migrations.mjs";

const contract = await loadTranspiledModule(
  "src/features/planning-items/model/planning-items-contract.ts",
);

test("latest Planning token authentication contract returns safe access metadata", async () => {
  const corpus = await readSupabaseMigrationCorpus();
  const latestDefinition = corpus.slice(corpus.lastIndexOf(
    "CREATE OR REPLACE FUNCTION public.authenticate_team_planning_items_token",
  ));
  for (const field of [
    "'tokenHint'",
    "'scopeGranted'",
    "'expiresAt'",
    "'evaluatedAt'",
    "'remainingSeconds'",
  ]) {
    assert.match(latestDefinition, new RegExp(field));
  }
  assert.doesNotMatch(latestDefinition, /planning items scope is missing/);
  assert.match(latestDefinition, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(latestDefinition, /GRANT EXECUTE ON FUNCTION[\s\S]*TO service_role/);
});

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

async function loadRoute(authResult) {
  return loadTranspiledModule(
    "src/features/planning-items/model/planning-items-route.ts",
    {
      "next/server": {
        NextResponse: {
          json: (body, init = {}) => Response.json(body, init),
        },
      },
      "@/features/planning-items/model/planning-items-contract": contract,
      "@/features/planning-items/model/planning-items-token": {
        requireTeamPlanningItemScope: async () => authResult,
      },
    },
  );
}

test("Planning API decorates successful and domain-error responses after valid token access", async () => {
  const route = await loadRoute(basePermission);
  const accessRequest = {
    operation: "planningContext.read",
    mode: "read",
    requiredScopes: ["read:planning-context"],
  };
  const success = await route.handlePlanningItemsRequest(
    { headers: new Headers() },
    accessRequest,
    "fallback",
    async () => route.planningItemsJson({ ok: true, context: {} }),
  );
  assert.equal(success.status, 200);
  assert.equal(success.headers.get("cache-control"), "no-store");
  assert.deepEqual((await success.json())._meta, {
    operation: "planningContext.read",
    mode: "read",
    access: {
      evaluatedAt: "2026-08-19T10:00:00Z",
      decision: "allowed",
      token: {
        hint: "…a8F31x",
        grantedScopes: ["read:planning-context", "write:planning-items:create"],
        expiresAt: "2026-09-03T10:00:00Z",
        remainingSeconds: 1_296_000,
      },
      requiredScopes: ["read:planning-context"],
      missingScopes: [],
    },
  });

  const invalidPayload = await route.handlePlanningItemsRequest(
    { headers: new Headers() },
    accessRequest,
    "fallback",
    async () => route.planningItemsError("Payload ist ungültig.", 400),
  );
  assert.equal(invalidPayload.status, 400);
  assert.equal((await invalidPayload.json())._meta.access.decision, "allowed");
});

test("Planning API returns a structured denied preview before calling the handler", async () => {
  const route = await loadRoute({
    ...basePermission,
    scopes: ["write:planning-items:update"],
  });
  let handlerCalls = 0;
  let payloadChecks = 0;
  const response = await route.handlePlanningItemsRequest(
    { headers: new Headers() },
    {
      operation: "planningItems.update",
      mode: "preview",
      requiredScopes: ["write:planning-items:update"],
      resolveAdditionalScopes: async () => {
        payloadChecks += 1;
        return ["write:planning-items:github-sync"];
      },
    },
    "fallback",
    async () => {
      handlerCalls += 1;
      return route.planningItemsJson({ ok: true });
    },
  );
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(handlerCalls, 0);
  assert.equal(payloadChecks, 1);
  assert.equal(body.code, "INSUFFICIENT_SCOPE");
  assert.match(body.error, /Preview wurde nicht ausgeführt/);
  assert.deepEqual(body._meta.access.requiredScopes, [
    "write:planning-items:update",
    "write:planning-items:github-sync",
  ]);
  assert.deepEqual(body._meta.access.missingScopes, [
    "write:planning-items:github-sync",
  ]);
  assert.equal(body._meta.access.decision, "denied");
  assert.equal(
    response.headers.get("www-authenticate"),
    'Bearer error="insufficient_scope"',
  );
});

test("Planning API denies the base scope before resolving payload-dependent scopes", async () => {
  const route = await loadRoute({
    ...basePermission,
    scopes: [],
    scopeGranted: false,
  });
  let payloadChecks = 0;
  const response = await route.handlePlanningItemsRequest(
    { headers: new Headers() },
    {
      operation: "planningItems.create",
      mode: "preview",
      requiredScopes: ["write:planning-items:create"],
      resolveAdditionalScopes: async () => {
        payloadChecks += 1;
        return ["write:planning-items:github-sync"];
      },
    },
    "fallback",
    async () => route.planningItemsJson({ ok: true }),
  );
  const body = await response.json();
  assert.equal(response.status, 403);
  assert.equal(payloadChecks, 0);
  assert.deepEqual(body._meta.access.requiredScopes, ["write:planning-items:create"]);
  assert.deepEqual(body._meta.access.missingScopes, ["write:planning-items:create"]);
});

test("Planning API keeps inactive token responses generic and without access metadata", async () => {
  const route = await loadRoute({
    ok: false,
    status: 401,
    code: "TOKEN_INACTIVE",
    error: "Planning-API-Token ist ungültig oder abgelaufen.",
  });
  const response = await route.handlePlanningItemsRequest(
    { headers: new Headers() },
    {
      operation: "planningContext.read",
      mode: "read",
      requiredScopes: ["read:planning-context"],
    },
    "fallback",
    async () => {
      throw new Error("must not run");
    },
  );
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.code, "TOKEN_INACTIVE");
  assert.equal("_meta" in body, false);
  assert.equal(response.headers.get("www-authenticate"), 'Bearer error="invalid_token"');
});

test("Planning API omits stale access metadata after a late credential rejection", async () => {
  const route = await loadRoute(basePermission);
  const response = await route.handlePlanningItemsRequest(
    { headers: new Headers() },
    {
      operation: "planningItems.create",
      mode: "commit",
      requiredScopes: ["write:planning-items:create"],
    },
    "fallback",
    async () => route.planningItemsTokenInactiveError(),
  );
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.equal(body.code, "TOKEN_INACTIVE");
  assert.equal("_meta" in body, false);
  assert.equal(response.headers.get("www-authenticate"), 'Bearer error="invalid_token"');
});

async function loadTokenModule(rpcResult) {
  return loadTranspiledModule(
    "src/features/planning-items/model/planning-items-token.ts",
    {
      "@/lib/supabase": {
        getServerSupabase: () => ({ rpc: async () => rpcResult }),
      },
      "@/features/planning-items/model/planning-items-contract": contract,
    },
  );
}

test("Planning token authentication preserves the safe database receipt", async () => {
  const token = await loadTokenModule({
    data: {
      tokenId: "token-1",
      tokenHint: "…a8F31x",
      scopes: ["read:planning-context"],
      scopeGranted: true,
      expiresAt: "2026-09-03T10:00:00Z",
      evaluatedAt: "2026-08-19T10:00:00Z",
      remainingSeconds: 12.9,
      profile: { id: "profile-1", platformRole: "ceo" },
    },
    error: null,
  });
  const result = await token.requireTeamPlanningItemScope({
    headers: new Headers({ authorization: "Bearer fmd_ti_test-token" }),
  }, "read:planning-context");
  assert.equal(result.ok, true);
  assert.equal(result.tokenHint, "…a8F31x");
  assert.equal(result.remainingSeconds, 12);
});

test("Planning token authentication classifies inactive and malformed receipts without metadata", async () => {
  const inactiveToken = await loadTokenModule({
    data: null,
    error: { code: "P0004" },
  });
  const inactive = await inactiveToken.requireTeamPlanningItemScope({
    headers: new Headers({ authorization: "Bearer fmd_ti_expired" }),
  }, "read:planning-context");
  assert.deepEqual(inactive, {
    ok: false,
    status: 401,
    code: "TOKEN_INACTIVE",
    error: "Planning-API-Token ist ungültig oder abgelaufen.",
  });

  const malformedToken = await loadTokenModule({
    data: { tokenId: "token-1" },
    error: null,
  });
  const malformed = await malformedToken.requireTeamPlanningItemScope({
    headers: new Headers({ authorization: "Bearer fmd_ti_malformed" }),
  }, "read:planning-context");
  assert.equal(malformed.ok, false);
  assert.equal(malformed.code, "AUTHORIZATION_UNAVAILABLE");
  assert.equal("scopes" in malformed, false);
});

test("Planning token authentication preserves scope and profile failure codes", async () => {
  const cases = [
    {
      providerCode: "P0005",
      status: 403,
      code: "INSUFFICIENT_SCOPE",
      error: "Planning-API-Token hat nicht den erforderlichen Scope.",
    },
    {
      providerCode: "P0006",
      status: 403,
      code: "TOKEN_PROFILE_FORBIDDEN",
      error: "Planning-API-Token ist keinem operativen FounderOps-Profil zugeordnet.",
    },
  ];
  for (const expected of cases) {
    const token = await loadTokenModule({
      data: null,
      error: { code: expected.providerCode },
    });
    const result = await token.requireTeamPlanningItemScope({
      headers: new Headers({ authorization: "Bearer fmd_ti_rejected" }),
    }, "read:planning-context");
    assert.deepEqual(result, {
      ok: false,
      status: expected.status,
      code: expected.code,
      error: expected.error,
    });
    assert.equal("scopes" in result, false);
    assert.equal("expiresAt" in result, false);
  }
});

test("Planning token authentication distinguishes missing credentials from an unknown bearer", async () => {
  let rpcCalls = 0;
  const token = await loadTranspiledModule(
    "src/features/planning-items/model/planning-items-token.ts",
    {
      "@/lib/supabase": {
        getServerSupabase: () => ({
          rpc: async () => {
            rpcCalls += 1;
            return { data: null, error: null };
          },
        }),
      },
      "@/features/planning-items/model/planning-items-contract": contract,
    },
  );

  const missing = await token.requireTeamPlanningItemScope({
    headers: new Headers(),
  }, "read:planning-context");
  assert.equal(missing.code, "TOKEN_REQUIRED");

  const malformed = await token.requireTeamPlanningItemScope({
    headers: new Headers({ authorization: "Basic malformed" }),
  }, "read:planning-context");
  assert.equal(malformed.code, "TOKEN_REQUIRED");

  const unknown = await token.requireTeamPlanningItemScope({
    headers: new Headers({ authorization: "Bearer unknown-token" }),
  }, "read:planning-context");
  assert.equal(unknown.code, "TOKEN_INACTIVE");
  assert.equal(rpcCalls, 0);
});

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
