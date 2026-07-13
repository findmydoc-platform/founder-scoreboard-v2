import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const publicPaths = [
  "/api/team/planning-items/v1/context",
  "/api/team/planning-items/v1/items/preview",
  "/api/team/planning-items/v1/items",
  "/api/team/planning-items/v1/items/{id}/preview",
  "/api/team/planning-items/v1/items/{id}",
  "/api/team/planning-items/v1/tokens",
  "/api/team/planning-items/v1/tokens/{id}",
];

test("Planning Items API exposes a create and PATCH contract without legacy HTTP aliases", async () => {
  const [contract, contextRoute, createPreviewRoute, createRoute, updatePreviewRoute, updateRoute, tokensRoute, tokenRoute, openapi, documentation] = await Promise.all([
    read("src/features/planning-items/model/planning-items-contract.ts"),
    read("src/app/api/team/planning-items/v1/context/route.ts"),
    read("src/app/api/team/planning-items/v1/items/preview/route.ts"),
    read("src/app/api/team/planning-items/v1/items/route.ts"),
    read("src/app/api/team/planning-items/v1/items/[id]/preview/route.ts"),
    read("src/app/api/team/planning-items/v1/items/[id]/route.ts"),
    read("src/app/api/team/planning-items/v1/tokens/route.ts"),
    read("src/app/api/team/planning-items/v1/tokens/[id]/route.ts"),
    read("public/founderops-team-planning-items-openapi.json"),
    read("docs/team-planning-items-api.md"),
  ]);

  assert.match(contract, /"read:planning-context"/);
  assert.match(contract, /"write:planning-items:create"/);
  assert.match(contract, /"write:planning-items:update"/);
  assert.match(contextRoute, /"read:planning-context"/);
  assert.match(createPreviewRoute, /"write:planning-items:create"/);
  assert.match(createRoute, /create_team_planning_items_transaction/);
  assert.match(updatePreviewRoute, /"write:planning-items:update"/);
  assert.match(updateRoute, /update_team_planning_item_transaction/);
  assert.match(updateRoute, /team_planning_item_update_requests/);
  assert.match(updateRoute, /existingRequest/);
  assert.match(updateRoute, /replayCheck/);
  assert.match(tokensRoute, /create_team_planning_items_token/);
  assert.match(tokensRoute, /allowUpdates/);
  assert.match(tokenRoute, /revoke_team_planning_items_token/);

  const document = JSON.parse(openapi);
  assert.equal(document.info.title, "FounderOps Planning Items API");
  assert.deepEqual(Object.keys(document.paths), publicPaths);
  assert.equal(document.paths["/api/team/planning-items/v1/items/{id}"].patch.operationId, "updatePlanningItem");
  assert.equal(document.paths["/api/team/planning-items/v1/items/{id}/preview"].post.operationId, "previewPlanningItemUpdate");
  assert.equal(document.paths["/api/team/planning-items/v1/tokens"].post.operationId, "createPlanningItemsToken");
  assert.equal(document.paths["/api/team/planning-items/v1/items/{id}"].patch.parameters[1].$ref, "#/components/parameters/IdempotencyKey");
  assert.match(documentation, /PATCH processes only properties that are present/);
  assert.match(documentation, /No legacy HTTP aliases are retained/);
});

test("legacy public Team Task Intake routes and source modules are absent", async () => {
  for (const path of [
    "src/app/api/team/task-context/route.ts",
    "src/app/api/team/task-intake/v2/preview/route.ts",
    "src/app/api/team/task-intake/v2/commit/route.ts",
    "src/app/api/team/task-intake-tokens/route.ts",
    "src/features/intake/model/team-task-intake-contract.ts",
    "src/features/intake/model/team-task-intake-v2.ts",
  ]) {
    await assert.rejects(access(new URL(path, root)));
  }
});

test("PATCH implementation keeps type-specific fields, compare-and-set, and idempotency explicit", async () => {
  const [updateModel, migration] = await Promise.all([
    read("src/features/planning-items/model/planning-item-update.ts"),
    read("supabase/migrations/20260713182811_planning_items_api_updates.sql"),
  ]);

  assert.match(updateModel, /expectedUpdatedAt muss ein gültiger Zeitstempel sein/);
  assert.match(updateModel, /itemType ist unveränderlich/);
  assert.match(updateModel, /founderInitiativeFields/);
  assert.match(updateModel, /founderTaskBriefFields/);
  assert.match(updateModel, /githubRepo kann nur vor der GitHub-Synchronisierung geändert werden/);
  assert.match(migration, /team_planning_item_update_requests/);
  assert.match(migration, /write:planning-items:update/);
  assert.match(migration, /planning item was changed concurrently/);
  assert.match(migration, /idempotency key conflict/);
  assert.match(migration, /packages_touch_updated_at/);
});

test("PATCH normalizers preserve explicit zeroes and clear only fields supplied as null or blank", async () => {
  const normalizers = await loadTranspiledModule(
    "src/features/planning-items/model/planning-item-normalization.ts",
    {
      "@/lib/api-input": {
        cleanText: (value, maxLength) => String(value || "").trim().slice(0, maxLength),
      },
      "@/lib/slug": { normalizeLookup: (value) => value, slugify: (value) => value },
      "@/features/planning-items/model/planning-items-contract": { PLANNING_ITEM_FIELD_RULES: {} },
    },
  );

  assert.deepEqual(normalizers.normalizePatchHours(0), { ok: true, value: 0 });
  assert.deepEqual(normalizers.normalizePatchText("   ", 40), { ok: true, value: null });
  assert.deepEqual(normalizers.normalizePatchText(null, 40), { ok: true, value: null });
  assert.deepEqual(normalizers.normalizePatchStringList([" owner ", "owner", "reviewer"]), {
    ok: true,
    value: ["owner", "reviewer"],
  });
  assert.equal(normalizers.normalizePatchStringList([], true).ok, false);
});
