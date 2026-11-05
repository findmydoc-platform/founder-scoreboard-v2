import assert from "node:assert/strict";
import { test } from "vitest";
import * as repositories from "../../../src/lib/github-repositories";
import { importTestModule } from "../../helpers/vitest-module.mjs";

async function loadCreate() {
  const contract = await importTestModule("src/features/planning-items/model/planning-items-contract.ts");
  const deliverableSchedule = await importTestModule(
    "src/features/planning-items/model/deliverable-schedule.ts",
  );
  const reviewState = await importTestModule("src/features/reviews/model/task-review-state.ts");
  const normalization = await importTestModule(
    "src/features/planning-items/model/planning-item-normalization.ts",
    {
      "@/lib/api-input": { cleanText: (value, maxLength) => String(value || "").trim().slice(0, maxLength) },
      "@/lib/slug": { normalizeLookup: (value) => value, slugify: (value) => value },
      "@/features/planning-items/model/planning-items-contract": contract,
      "@/features/planning-items/model/deliverable-schedule": deliverableSchedule,
    },
  );
  return importTestModule(
    "src/features/planning-items/model/planning-items-create.ts",
    {
      "@/lib/planning-read-model": { ACTIVE_TASKS_TABLE: "active_tasks" },
      "@/lib/github-repositories": repositories,
      "@/features/planning-items/model/planning-items-contract": contract,
      "@/features/planning-items/model/planning-item-normalization": normalization,
      "@/features/planning-items/model/deliverable-schedule": deliverableSchedule,
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
  const route = await importTestModule(
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
        handlePlanningItemsRequest: async (_request, access, _fallback, handler) => handler({ ...permission, profile: { id: tokenActor.profileId, platformRole: "ceo" }, planningItems: {
          create: async (dependencies, invocation) => {
            captured.dependencies = dependencies;
            captured.invocation = { ...invocation, mode: access.mode };
            if (previewItems) dependencies.onPreview?.(previewItems);
            return runResult;
          },
        } }),
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

test("CreateItems maps all four canonical transport item types", async () => {
  const create = await loadCreate();
  const command = create.planningItemCreateCommand([
    { itemType: "epic", title: "Epic", description: "Direction", ownerId: "ceo-1", status: "Offen" },
    { itemType: "initiative", title: "Initiative", ownerId: "ceo-1", parentTaskId: "epic-1", accountableProfileId: "ceo-1", responsibleProfileIds: ["founder-1"] },
    { itemType: "deliverable", title: "Deliverable", parentTaskId: "initiative-1", ownerId: "founder-1", definitionOfDone: "Done", fixedDate: "2026-09-10" },
    { itemType: "sub_issue", title: "Sub-Issue", parentTaskId: "deliverable-1", githubRepo: "findmydoc-platform/website" },
  ], "ceo-1");

  assert.deepEqual(command.items.map((item) => item.kind), ["epic", "initiative", "deliverable", "sub_issue"]);
  assert.equal(command.items[1].parentId, "epic-1");
  assert.equal(command.items[2].parentId, "initiative-1");
  assert.equal(command.items[2].fixedDate, "2026-09-10");
  assert.equal(command.items[3].ownerId, "ceo-1");
});

test("Team create accepts fixedDate and rejects legacy deliverable schedule fields", async () => {
  const create = await loadCreate();
  const valid = create.parsePlanningItemCreatePayload({
    items: [{ itemType: "deliverable", title: "Scheduled", fixedDate: "2026-09-10" }],
  });
  assert.equal(valid.ok, true);

  for (const field of ["startDate", "endDate", "deadline"]) {
    const result = create.parsePlanningItemCreatePayload({
      items: [{ itemType: "deliverable", title: "Legacy", [field]: "2026-09-10" }],
    });
    assert.equal(result.ok, false);
    assert.match(result.error, new RegExp(`unbekannte Feld ${field}`));
  }
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
      params: { item: { id: "epic-1" }, strategy: null, raciAssignments: [], notifications: [] },
    },
  }).run({ actor, mode: "commit", command });

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "create_browser_planning_item_transaction_v2");
  assert.deepEqual(calls[0][1].p_notifications, []);
  assert.equal(create.browserCreateTransactionFromResult(result).task.id, "epic-1");
});

test("CreateItems rejects empty and oversized batches before a writer", async () => {
  const create = await loadCreate();
  let rpcCalls = 0;
  const planningItems = create.createBrowserCreatePlanningItems({
    supabase: { rpc: async () => { rpcCalls += 1; return { data: null, error: null }; } },
    actor,
    writer: { kind: "strategic", params: { item: {}, strategy: null, raciAssignments: [], notifications: [] } },
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

test("Team create rejects stored pre-v3 replay receipts before preview or writer effects", async () => {
  const create = await loadCreate();
  const rawItems = [{ itemType: "epic", title: "Current", description: "Snapshot", ownerId: actor.profileId }];
  const responseItems = [{ itemType: "epic", item: { id: "epic-v1", title: "Current" } }];
  let rpcCalls = 0;
  let previews = 0;
  const query = {
    select() { return this; },
    eq() { return this; },
    async maybeSingle() { return { data: { id: "batch-v2", request_hash: "stored-v2", response_tasks: responseItems, contract_version: 2 }, error: null }; },
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

test("CreateItems keeps long briefs and list entries intact", async () => {
  const create = await loadCreate();
  const description = "ä".repeat(5000);
  const criterion = "😀".repeat(3500);
  const command = create.planningItemCreateCommand([{ itemType: "deliverable", title: "Long brief", description, acceptanceCriteria: [criterion] }], actor.profileId);
  assert.equal(command.items[0].brief.description, description);
  assert.equal(command.items[0].brief.acceptanceCriteria, criterion);
});

test("Team create rejects an oversized item atomically in preview and commit", async () => {
  const create = await loadCreate();
  const tokenActor = { ...actor, credential: { kind: "planningToken", tokenId: "token-1", scopes: ["write:planning-items:create"] } };
  const rawItems = [
    { itemType: "epic", title: "Valid epic", description: "x".repeat(5000), ownerId: actor.profileId },
    { itemType: "epic", title: "Oversized epic", description: "😀".repeat(65_537), ownerId: actor.profileId },
  ];
  let writes = 0;
  const supabase = {
    from(table) {
      const query = {
        select() { return this; }, eq() { return this; },
        async maybeSingle() { return { data: null, error: null }; },
        then(resolve) { return Promise.resolve({ data: table === "profiles" ? [{ id: actor.profileId, name: "CEO" }] : [], error: null }).then(resolve); },
      };
      return query;
    },
    async rpc() { writes += 1; throw new Error("Invalid content must not write"); },
  };
  for (const mode of ["preview", "commit"]) {
    let previews;
    const result = await create.createTeamCreatePlanningItems({ supabase, actor: tokenActor, tokenId: "token-1", rawItems, githubSyncMode: null, onPreview: (items) => { previews = items; } }).run({ actor: tokenActor, mode, command: create.planningItemCreateCommand(rawItems, actor.profileId), idempotencyKey: "00000000-0000-4000-8000-000000000000" });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "invalidCommand");
    assert.equal(previews[0].description.length, 5000);
    assert.equal(Array.from(previews[1].description).length, 65_537);
    assert.equal(previews[1].lengthErrors[0].excess, 1);
  }
  assert.equal(writes, 0);
});

test("Create request hashes distinguish content beyond the former truncation boundary", async () => {
  const create = await loadCreate();
  const first = [{ itemType: "epic", title: "Same", description: "x".repeat(4000) + "A" }];
  const second = [{ ...first[0], description: "x".repeat(4000) + "B" }];
  assert.notEqual(create.planningItemCreateHash(first, null, []), create.planningItemCreateHash(second, null, []));
});


test("create replay survives changed mention expansion diagnostics", async () => {
  const create = await loadCreate();
  const rawItems = [{ itemType: "deliverable", title: "Mention replay", description: "x".repeat(65_000) + " @all other-org/outside-repo#123", ownerId: actor.profileId }];
  const responseItems = [{ itemType: "deliverable", item: { id: "saved-task" } }];
  let expanded = false;
  let stored = null;
  const supabase = {
    from(table) {
      const query = {
        select() { return this; }, eq() { return this; },
        async maybeSingle() { return { data: table === "team_task_intake_batches" ? stored : null, error: null }; },
        then(resolve) { return Promise.resolve({ data: table === "profiles" ? [{ id: actor.profileId, name: "CEO", github_login: "ceo" }, ...(expanded ? Array.from({ length: 100 }, (_, i) => ({ id: `profile-${i}`, name: `Member ${i}`, github_login: `member-${i}` })) : [])] : [], error: null }).then(resolve); },
      };
      return query;
    },
    rpc() { throw new Error("Replay must not write"); },
  };
  const key = "a1111111-1111-4111-8111-111111111111";
  const initial = await create.buildPlanningItemCreatePreview(rawItems, { id: actor.profileId, platformRole: "ceo" }, supabase, key);
  assert.equal(initial[0].lengthErrors, undefined);
  stored = { id: "batch-1", request_hash: create.planningItemCreateHash(initial), response_tasks: responseItems, contract_version: 3 };
  expanded = true;
  const tokenActor = { ...actor, credential: { kind: "planningToken", tokenId: "token-1", scopes: ["write:planning-items:create"] } };
  let preview;
  const result = await create.createTeamCreatePlanningItems({ supabase, actor: tokenActor, tokenId: "token-1", rawItems, githubSyncMode: null, onPreview: (items) => { preview = items; } }).run({
    actor: tokenActor, mode: "commit", command: create.planningItemCreateCommand(rawItems, actor.profileId), idempotencyKey: key,
  });
  assert.equal(preview[0].lengthErrors[0].field, "githubBody");
  assert.equal(result.ok, true);
  assert.equal(create.planningCreateTransactionFromResult(result).replayed, true);
  assert.deepEqual(create.planningCreateTransactionFromResult(result).items, responseItems);
});


test("invalid create commit returns per-item structured diagnostics with HTTP 400", async () => {
  const lengthErrors = [{ field: "githubBody", actual: 65_537, maximum: 65_536, excess: 1, message: "Body too long" }];
  const previewItems = [{ errors: ["Body too long"], lengthErrors }];
  const { route } = await loadTeamCreateRoute({
    runResult: { ok: false, error: { code: "invalidCommand", issues: [{ path: "command.items.0", reason: "Body too long" }] } },
    previewItems,
    planningCreateError: () => ({ message: "Invalid batch", status: 400, issues: previewItems[0].errors }),
  });
  const response = await route.handleTeamPlanningItemsCreate({
    headers: new Headers({ "idempotency-key": "00000000-0000-4000-8000-000000000000" }),
    json: async () => ({ items: [{ itemType: "deliverable", title: "Create" }] }),
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.ok, false);
  assert.deepEqual(response.body.items[0].lengthErrors, lengthErrors);
});


test("create preview links full GitHub references without changing authored fields or commit payloads", async () => {
  const create = await loadCreate();
  const text = "Änderung in other-org/outside-repo#123";
  const query = {
    select() { return this; }, eq() { return this; },
    then(resolve) { return Promise.resolve({ data: [{ id: actor.profileId, name: "CEO" }], error: null }).then(resolve); },
  };
  const items = await create.buildPlanningItemCreatePreview([
    { itemType: "deliverable", title: text, description: text, problemStatement: text },
    { itemType: "epic", title: text, description: text, ownerId: actor.profileId },
  ], { id: actor.profileId, platformRole: "ceo" }, { from: () => query });
  assert.deepEqual(items[0].linkedBrief, {
    description: "Änderung in [other-org/outside-repo#123](https://github.com/other-org/outside-repo/issues/123)",
    problemStatement: "Änderung in [other-org/outside-repo#123](https://github.com/other-org/outside-repo/issues/123)",
    intendedOutcome: "", scopeConstraints: "", acceptanceCriteria: "", evidenceRequired: "", definitionOfDone: "",
  });
  assert.equal(items[0].description, text);
  assert.equal(items[0].problemStatement, text);
  assert.equal(items[0].title, text);
  assert.equal(items[1].linkedBrief, undefined);
  assert.equal(create.planningItemCreateCommitItem(items[0]).linkedBrief, undefined);
  const withoutLinks = items.map((item) => { const source = { ...item }; delete source.linkedBrief; return source; });
  assert.equal(create.planningItemCreateHash(items), create.planningItemCreateHash(withoutLinks));
});


test("create preview preserves Markdown protection and invalid full reference tokens byte for byte", async () => {
  const create = await loadCreate();
  const protectedText = [
    "[other-org/repo#1](https://example.com/fixed?q=other-org/repo#2)",
    "[other-org/repo#3][target]", "[other-org/repo#4][]", "[other-org/repo#5]",
    "", "[other-org/repo#4]: https://example.com/collapsed",
    "[other-org/repo#5]: https://example.com/shortcut",
    "[multiline]: https://example.com/path\n  \"other-org/repo#24\"",
    "[target]: https://github.com/other-org/repo/issues/6#issuecomment-7 \"other-org/repo#8\"", "",
    "https://example.com/path/other-org/repo#9?q=owner/repo#10",
    "<https://github.com/other-org/repo/issues/11#issuecomment-12>",
    "`other-org/repo#13`", "``other-org/repo#14 ` still code``",
    "```md\nother-org/repo#15\n```", "~~~\nother-org/repo#16\n~~~",
    "    other-org/repo#17", "\tother-org/repo#18",
    String.raw`\other-org/repo#19 other-org/repo\#20`,
    "owner/repo#0 owner/repo#-1 owner/repo# owner/repo#1abc owner/repo#1.5",
    "bad_owner/repo#1 -owner/repo#1 owner-/repo#1 owner/repo/extra#1 owner/../repo#1 ba\u0308d/repo#1",
    "#123 unknown#361 unknown-other#362",
  ].join("\n");
  const query = { select() { return this; }, eq() { return this; }, then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); } };
  const preview = (description) => create.buildPlanningItemCreatePreview([
    { itemType: "deliverable", title: "Protected references", description },
  ], { id: actor.profileId, platformRole: "ceo" }, { from: () => query });
  const text = `Änderung other-org/repo#21.\n${protectedText}\nAuch findmydoc-platform/founder-scoreboard-v2#397`;
  const expected = `Änderung [other-org/repo#21](https://github.com/other-org/repo/issues/21).\n${protectedText}\nAuch [findmydoc-platform/founder-scoreboard-v2#397](https://github.com/findmydoc-platform/founder-scoreboard-v2/issues/397)`;
  const [item] = await preview(text);
  assert.equal(item.linkedBrief.description, expected);
  assert.equal(item.description, text);
  const [again] = await preview(item.linkedBrief.description);
  assert.equal(again.linkedBrief.description, expected);
});


test("create preview resolves approved repository names independently of the task repository", async () => {
  const create = await loadCreate();
  const text = "Änderung management#361, website#12 und other-org/outside-repo#123; unknown#361";
  const query = { select() { return this; }, eq() { return this; }, then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); } };
  const [item] = await create.buildPlanningItemCreatePreview([
    { itemType: "sub_issue", title: "Repository references", description: text, githubRepo: "findmydoc-platform/clinic-dashboard" },
  ], { id: actor.profileId, platformRole: "ceo" }, { from: () => query });
  assert.equal(item.linkedBrief.description, "Änderung [management#361](https://github.com/findmydoc-platform/management/issues/361), [website#12](https://github.com/findmydoc-platform/website/issues/12) und [other-org/outside-repo#123](https://github.com/other-org/outside-repo/issues/123); unknown#361");
  assert.equal(item.description, text);
  assert.equal(item.githubRepo, "findmydoc-platform/clinic-dashboard");
  assert.equal(create.planningItemCreateCommitItem(item).linkedBrief, undefined);
  const authoredItem = { ...item };
  delete authoredItem.linkedBrief;
  assert.equal(create.planningItemCreateHash([item]), create.planningItemCreateHash([authoredItem]));
});


test("create preview uses configured repository names and preserves ambiguous and invalid complete tokens", async () => {
  const create = await loadCreate();
  const description = "research-notes#17 management#361 unknown#361 management#0 management#-1 management# management#1abc bad/management#1/extra";
  const query = { select() { return this; }, eq() { return this; }, then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); } };
  const preview = () => create.buildPlanningItemCreatePreview([
    { itemType: "deliverable", title: "Configured repository references", description },
  ], { id: actor.profileId, platformRole: "ceo" }, { from: () => query });
  const [baseline] = await preview();
  repositories.allowedGitHubRepositories.add("another-owner/research-notes");
  repositories.allowedGitHubRepositories.add("another-owner/management");
  try {
    const [item] = await preview();
    assert.equal(item.linkedBrief.description, "[research-notes#17](https://github.com/another-owner/research-notes/issues/17) management#361 unknown#361 management#0 management#-1 management# management#1abc bad/management#1/extra");
    assert.equal(item.description, description);
    assert.deepEqual(item.warnings, baseline.warnings);
    assert.equal(item.githubRepo, "findmydoc-platform/management");
  } finally {
    repositories.allowedGitHubRepositories.delete("another-owner/research-notes");
    repositories.allowedGitHubRepositories.delete("another-owner/management");
  }
});


test("create preview preserves shortened references in protected Markdown and remains idempotent", async () => {
  const create = await loadCreate();
  const protectedText = [
    "[management#1][fixed]", "", "[fixed]: https://example.com/path#comment \"website#2\"", "",
    "https://example.com/path?q=management#3", "`website#4`",
    "```md\nmanagement#5\n```", "", "    website#6", "",
    String.raw`\management#7 website\#8`,
  ].join("\n");
  const description = `Änderung management#361.\n${protectedText}`;
  const expected = `Änderung [management#361](https://github.com/findmydoc-platform/management/issues/361).\n${protectedText}`;
  const query = { select() { return this; }, eq() { return this; }, then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); } };
  const preview = (text) => create.buildPlanningItemCreatePreview([
    { itemType: "deliverable", title: "Protected repository references", description: text },
  ], { id: actor.profileId, platformRole: "ceo" }, { from: () => query });
  const [item] = await preview(description);
  assert.equal(item.linkedBrief.description, expected);
  assert.equal(item.description, description);
  const [again] = await preview(item.linkedBrief.description);
  assert.equal(again.linkedBrief.description, expected);
});
