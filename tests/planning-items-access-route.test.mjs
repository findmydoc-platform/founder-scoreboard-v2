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
