import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

async function loadCreate() {
  const contract = await loadTranspiledModule("src/features/planning-items/model/planning-items-contract.ts");
  const reviewState = await loadTranspiledModule("src/features/reviews/model/task-review-state.ts");
  const normalization = await loadTranspiledModule(
    "src/features/planning-items/model/planning-item-normalization.ts",
    {
      "@/lib/api-input": { cleanText: (value, maxLength) => String(value || "").trim().slice(0, maxLength) },
      "@/lib/slug": { normalizeLookup: (value) => value, slugify: (value) => value },
      "@/features/planning-items/model/planning-items-contract": contract,
    },
  );
  return loadTranspiledModule(
    "src/features/planning-items/model/planning-items-create.ts",
    {
      "@/lib/planning-read-model": { ACTIVE_TASKS_TABLE: "active_tasks" },
      "@/lib/github-repositories": {
        defaultGitHubRepository: "findmydoc-platform/management",
        resolveTaskGitHubRepository: (_kind, requested) => ({ ok: true, repository: requested || "findmydoc-platform/management" }),
      },
      "@/features/planning-items/model/planning-items-contract": contract,
      "@/features/planning-items/model/planning-item-normalization": normalization,
      "@/features/planning-items/model/planning-items-github-sync-preview": {
        previewPlanningItemGitHubSync: () => ({ status: "accepted" }),
      },
      "@/features/reviews/model/task-review-state": reviewState,
    },
  );
}

async function loadTeamCreateRoute({
  runResult,
  previewItems,
  planningCreateError = () => ({ message: "Planning-API-Schema ist noch nicht verfügbar.", status: 503 }),
}) {
  const captured = {};
  const permission = {
    supabase: {},
    tokenId: "token-1",
    scopes: ["write:planning-items:create"],
    profile: { platformRole: "ceo" },
  };
  const tokenActor = {
    ...actor,
    credential: { kind: "planningToken", tokenId: "token-1", scopes: ["write:planning-items:create"] },
  };
  const route = await loadTranspiledModule(
    "src/features/planning-items/model/planning-items-team-create-route.ts",
    {
      "next/server": { after: () => undefined },
      "@/lib/api-input": { auditRequestMetadata: () => ({ request_ip: null, user_agent: undefined }) },
      "@/features/planning-items/model/planning-actor-context-server": {
        actorContextFromPlanningTokenAuth: () => ({ ok: true, actor: tokenActor }),
      },
      "@/features/planning-items/model/planning-items-contract": { isUuid: () => true },
      "@/features/planning-items/model/planning-items-create": {
        createTeamCreatePlanningItems: (dependencies) => ({
          run: async (invocation) => {
            captured.dependencies = dependencies;
            captured.invocation = invocation;
            if (previewItems) dependencies.onPreview?.(previewItems);
            return runResult;
          },
        }),
        parsePlanningItemCreatePayload: () => ({ ok: true, items: [{ itemType: "epic", title: "Preview" }], githubSyncMode: null }),
        planningCreateError,
        planningCreateTokenBecameInactive: (error) => error.code === "forbidden" && error.reason === "planningTokenInactive",
        planningCreateTransactionFromResult: () => null,
        planningItemCreateCommand: () => ({ kind: "createItems", items: [] }),
        planningItemCreateRequiresOperationalLead: () => false,
      },
      "@/features/planning-items/model/planning-items-github-projection": {
        dispatchAndLoadPlanningGitHubProjections: async () => new Map(),
      },
      "@/features/planning-items/model/planning-items-route": {
        handlePlanningItemsRequest: async (_request, _scope, _fallback, handler) => handler(permission),
        planningItemsError: (error, status) => ({ body: { ok: false, error }, status }),
        planningItemsJson: (body, status = 200) => ({ body, status }),
        planningItemsTokenInactiveError: () => ({
          body: { ok: false, code: "TOKEN_INACTIVE", error: "Planning-API-Token ist nicht mehr aktiv." },
          status: 401,
          headers: { "WWW-Authenticate": 'Bearer error="invalid_token"' },
        }),
      },
    },
  );
  return { route, captured };
}

const actor = {
  profileId: "ceo-1",
  platformRole: "ceo",
  credential: { kind: "session" },
};

test("Browser and Team create routes are transport-only adapters", async () => {
  const routes = await Promise.all([
    "src/app/api/tasks/route.ts",
    "src/app/api/team/planning-items/v2/items/route.ts",
    "src/app/api/team/planning-items/v2/items/preview/route.ts",
  ].map((path) => readFile(path, "utf8")));
  for (const route of routes) {
    assert.doesNotMatch(route, /\.rpc\(|\.from\(/);
  }
  assert.match(routes[0], /handleBrowserTaskCreate/);
  assert.match(routes[1], /handleTeamPlanningItemsCreate/);
  assert.match(routes[2], /handleTeamPlanningItemsCreatePreview/);
  const teamCreateRoute = await readFile("src/features/planning-items/model/planning-items-team-create-route.ts", "utf8");
  assert.match(teamCreateRoute, /createTeamCreatePlanningItems/);
  assert.match(teamCreateRoute, /mode: "preview"/);
});

test("CreateItems maps all four canonical transport item types", async () => {
  const create = await loadCreate();
  const command = create.planningItemCreateCommand([
    { itemType: "epic", title: "Epic", description: "Direction", ownerId: "ceo-1", status: "Offen" },
    { itemType: "initiative", title: "Initiative", ownerId: "ceo-1", parentTaskId: "epic-1", accountableProfileId: "ceo-1", responsibleProfileIds: ["founder-1"] },
    { itemType: "deliverable", title: "Deliverable", parentTaskId: "initiative-1", ownerId: "founder-1", definitionOfDone: "Done" },
    { itemType: "sub_issue", title: "Sub-Issue", parentTaskId: "deliverable-1", githubRepo: "findmydoc-platform/website" },
  ], "ceo-1");

  assert.deepEqual(command.items.map((item) => item.kind), ["epic", "initiative", "deliverable", "sub_issue"]);
  assert.equal(command.items[1].parentId, "epic-1");
  assert.equal(command.items[2].parentId, "initiative-1");
  assert.equal(command.items[3].ownerId, "ceo-1");
});

test("Browser CreateItems commits through exactly one hidden writer", async () => {
  const create = await loadCreate();
  const calls = [];
  const supabase = {
    rpc: async (name, params) => {
      calls.push([name, params]);
      return { data: { task: { id: "epic-1" } }, error: null };
    },
  };
  const command = create.planningItemCreateCommand([
    { itemType: "epic", title: "Epic", description: "Direction", ownerId: actor.profileId, status: "Offen" },
  ], actor.profileId);
  const result = await create.createBrowserCreatePlanningItems({
    supabase,
    actor,
    writer: {
      kind: "strategic",
      params: { item: { id: "epic-1" }, strategy: null, raciAssignments: [] },
    },
  }).run({ actor, mode: "commit", command });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "create_browser_planning_item_transaction");
  assert.equal(create.browserCreateTransactionFromResult(result).task.id, "epic-1");
});

test("CreateItems rejects empty and oversized batches before a writer", async () => {
  const create = await loadCreate();
  let rpcCalls = 0;
  const planningItems = create.createBrowserCreatePlanningItems({
    supabase: { rpc: async () => { rpcCalls += 1; return { data: null, error: null }; } },
    actor,
    writer: { kind: "strategic", params: { item: {}, strategy: null, raciAssignments: [] } },
  });
  const empty = await planningItems.run({ actor, mode: "commit", command: { kind: "createItems", items: [] } });
  const oversized = await planningItems.run({
    actor,
    mode: "commit",
    command: { kind: "createItems", items: Array.from({ length: 31 }, (_, index) => ({ ...create.planningItemCreateCommand([{ itemType: "epic", title: `Epic ${index}`, ownerId: actor.profileId }], actor.profileId).items[0] })) },
  });
  assert.equal(empty.ok, false);
  assert.equal(oversized.ok, false);
  assert.equal(rpcCalls, 0);
});

test("Team create rejects stored v1 replay receipts before preview or writer effects", async () => {
  const create = await loadCreate();
  const rawItems = [{ itemType: "epic", title: "Current", description: "Snapshot", ownerId: actor.profileId }];
  const responseItems = [{ itemType: "epic", item: { id: "epic-v1", title: "Current" } }];
  let rpcCalls = 0;
  let previews = 0;
  const query = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() { return { data: { id: "batch-v1", request_hash: "stored-v1", response_tasks: responseItems, contract_version: 1 }, error: null }; },
  };
  const tokenActor = { ...actor, credential: { kind: "planningToken", tokenId: "token-1", scopes: ["write:planning-items:create"] } };
  const result = await create.createTeamCreatePlanningItems({
    supabase: { from: () => query, rpc: async () => { rpcCalls += 1; return { data: null, error: null }; } },
    actor: tokenActor,
    tokenId: "token-1",
    rawItems,
    githubSyncMode: null,
    onPreview: () => { previews += 1; },
  }).run({
    actor: tokenActor,
    mode: "commit",
    command: create.planningItemCreateCommand(rawItems, actor.profileId),
    idempotencyKey: "key-1",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "conflict");
  assert.equal(result.error.reason, "idempotency");
  assert.equal(previews, 0);
  assert.equal(rpcCalls, 0);
});

test("Team create previews without reading idempotency receipts", async () => {
  const create = await loadCreate();
  const rawItems = [{ itemType: "epic", title: "Preview", description: "Snapshot", ownerId: actor.profileId }];
  const tokenActor = { ...actor, credential: { kind: "planningToken", tokenId: "token-1", scopes: ["write:planning-items:create"] } };
  const tables = [];
  const supabase = {
    from(table) {
      tables.push(table);
      if (table === "profiles") {
        return { select: async () => ({ data: [{ id: actor.profileId, name: "CEO" }], error: null }) };
      }
      if (table === "active_tasks") {
        return {
          select() { return this; },
          eq: async () => ({ data: [], error: null }),
        };
      }
      throw new Error(`Unexpected preview table: ${table}`);
    },
    rpc: async () => {
      throw new Error("Preview must not write");
    },
  };
  let previewItems;
  const result = await create.createTeamCreatePlanningItems({
    supabase,
    actor: tokenActor,
    tokenId: "token-1",
    rawItems,
    githubSyncMode: null,
    onPreview: (items) => { previewItems = items; },
  }).run({
    actor: tokenActor,
    mode: "preview",
    command: create.planningItemCreateCommand(rawItems, actor.profileId),
    idempotencyKey: "ignored-by-preview",
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, "previewed");
  assert.deepEqual(tables, ["profiles", "active_tasks"]);
  assert.equal(previewItems.length, 1);
});

test("Team create preview returns the runner failure instead of an empty success", async () => {
  const { route, captured } = await loadTeamCreateRoute({
    runResult: { ok: false, error: { code: "dependencyUnavailable", dependency: "database", retryable: false } },
  });

  const response = await route.handleTeamPlanningItemsCreatePreview({
    json: async () => ({ items: [{ itemType: "epic", title: "Preview" }] }),
  });

  assert.deepEqual(response, {
    body: { ok: false, error: "Planning-API-Schema ist noch nicht verfügbar." },
    status: 503,
  });
  assert.equal(captured.invocation.mode, "preview");
  assert.equal(captured.dependencies.onPreview instanceof Function, true);
});

test("Team create preview only reports success after it receives preview items", async () => {
  const previewItems = [{ errors: [] }];
  const { route } = await loadTeamCreateRoute({
    runResult: { ok: true, status: "previewed", items: [], changes: [], effects: [], warnings: [] },
    previewItems,
  });

  const response = await route.handleTeamPlanningItemsCreatePreview({
    json: async () => ({ items: [{ itemType: "epic", title: "Preview" }] }),
  });

  assert.deepEqual(response, {
    body: { ok: true, valid: true, items: previewItems },
    status: 200,
  });
});

test("Team create preview fails closed when a successful runner skips preview items", async () => {
  const { route } = await loadTeamCreateRoute({
    runResult: { ok: true, status: "previewed", items: [], changes: [], effects: [], warnings: [] },
  });

  const response = await route.handleTeamPlanningItemsCreatePreview({
    json: async () => ({ items: [{ itemType: "epic", title: "Preview" }] }),
  });

  assert.deepEqual(response, {
    body: { ok: false, error: "Planning-Items-Erstellung konnte nicht geprüft werden." },
    status: 500,
  });
});

test("Team create preview preserves completed invalid previews", async () => {
  const previewItems = [{ errors: ["Titel ist erforderlich."] }];
  const { route } = await loadTeamCreateRoute({
    runResult: {
      ok: false,
      error: { code: "invalidCommand", issues: [{ path: "command.items.0", reason: "Titel ist erforderlich." }] },
    },
    previewItems,
  });

  const response = await route.handleTeamPlanningItemsCreatePreview({
    json: async () => ({ items: [{ itemType: "epic", title: "Preview" }] }),
  });

  assert.deepEqual(response, {
    body: { ok: true, valid: false, items: previewItems },
    status: 200,
  });
});

test("Team create error mapping preserves public authentication and schema statuses", async () => {
  const create = await loadCreate();
  assert.deepEqual(create.planningCreateError({ code: "forbidden", reason: "planningTokenInactive" }), {
    message: "Planning-API-Token ist nicht mehr aktiv.",
    status: 401,
  });
  assert.deepEqual(create.planningCreateError({ code: "forbidden", reason: "planningTokenRejected" }), {
    message: "Planning-API-Berechtigung ist nicht mehr gültig.",
    status: 403,
  });
  assert.deepEqual(create.planningCreateError({ code: "dependencyUnavailable", dependency: "database", retryable: false }), {
    message: "Planning-API-Schema ist noch nicht verfügbar.",
    status: 503,
  });
});

test("Team create preserves a late inactive-token response", async () => {
  const { route } = await loadTeamCreateRoute({
    runResult: { ok: false, error: { code: "forbidden", reason: "planningTokenInactive" } },
  });
  const response = await route.handleTeamPlanningItemsCreate({
    headers: new Headers({ "idempotency-key": "00000000-0000-4000-8000-000000000000" }),
    json: async () => ({ items: [{ itemType: "epic", title: "Create" }] }),
  });
  assert.equal(response.status, 401);
  assert.equal(response.body.code, "TOKEN_INACTIVE");
  assert.equal(response.headers["WWW-Authenticate"], 'Bearer error="invalid_token"');
});
