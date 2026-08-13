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
  "/api/team/planning-items/v1/items/{id}/delete/preview",
  "/api/team/planning-items/v1/items/{id}",
  "/api/team/planning-items/v1/items/{id}/github-sync",
  "/api/team/planning-items/v1/tokens",
  "/api/team/planning-items/v1/tokens/{id}",
];

const v2PublicPaths = [
  "/api/team/planning-items/v2/context",
  "/api/team/planning-items/v2/items/preview",
  "/api/team/planning-items/v2/items",
  "/api/team/planning-items/v2/items/{id}/preview",
  "/api/team/planning-items/v2/items/{id}/delete/preview",
  "/api/team/planning-items/v2/items/{id}",
  "/api/team/planning-items/v2/items/{id}/github-sync",
];

test("Planning Items API exposes the canonical hierarchy, GitHub boundary, and empty Epic DELETE contracts", async () => {
  const [contract, epicContract, contextRoute, createPreviewRoute, createRoute, createHandler, createModule, updatePreviewRoute, deletePreviewRoute, deletePreviewHandler, updateRoute, updateModule, githubSyncRoute, githubSyncHandler, tokensRoute, tokenRoute, tokenUi, openapi, v2Openapi, apiContract, contextModule, documentation] = await Promise.all([
    read("src/features/planning-items/model/planning-items-contract.ts"),
    read("src/features/projects/model/epic-contract.ts"),
    read("src/app/api/team/planning-items/v1/context/route.ts"),
    read("src/app/api/team/planning-items/v1/items/preview/route.ts"),
    read("src/app/api/team/planning-items/v1/items/route.ts"),
    read("src/features/planning-items/model/planning-items-team-create-route.ts"),
    read("src/features/planning-items/model/planning-items-create.ts"),
    read("src/features/planning-items/model/planning-items-team-update-preview.ts"),
    read("src/app/api/team/planning-items/v1/items/[id]/delete/preview/route.ts"),
    read("src/features/planning-items/model/planning-items-team-delete-preview-route.ts"),
    read("src/features/planning-items/model/planning-items-team-update-route.ts"),
    read("src/features/planning-items/model/planning-item-update.ts"),
    read("src/app/api/team/planning-items/v1/items/[id]/github-sync/route.ts"),
    read("src/features/planning-items/model/planning-items-team-github-sync-route.ts"),
    read("src/app/api/team/planning-items/v1/tokens/route.ts"),
    read("src/app/api/team/planning-items/v1/tokens/[id]/route.ts"),
    read("src/features/profile/organisms/profile-planning-items-tokens.tsx"),
    read("public/founderops-team-planning-items-openapi.json"),
    read("public/founderops-team-planning-items-v2-openapi.json"),
    read("src/features/planning-items/model/planning-items-team-api-contract.ts"),
    read("src/features/planning-items/model/planning-items-context.ts"),
    read("docs/team-planning-items-api.md"),
  ]);

  assert.match(contract, /"read:planning-context"/);
  assert.match(contract, /"write:planning-items:create"/);
  assert.match(contract, /"write:planning-items:update"/);
  assert.match(contract, /"write:planning-items:delete-empty"/);
  assert.match(contract, /"write:planning-items:github-sync"/);
  assert.match(contract, /"epic"/);
  assert.match(contract, /Deprecated Team v1 transport alias/);
  assert.match(contextRoute, /teamPlanningItemsV1Contract/);
  assert.match(createPreviewRoute, /teamPlanningItemsV1Contract/);
  assert.doesNotMatch(createPreviewRoute, /Legacy-Aliase sind nicht mehr zulässig/);
  assert.match(createRoute, /teamPlanningItemsV1Contract/);
  assert.match(createHandler, /"write:planning-items:create"/);
  assert.match(createHandler, /createTeamCreatePlanningItems/);
  assert.match(createModule, /create_team_planning_items_with_projection_transaction/);
  assert.doesNotMatch(createRoute, /\.rpc\(/);
  assert.match(updatePreviewRoute, /"write:planning-items:update"/);
  assert.doesNotMatch(updatePreviewRoute, /Legacy-Aliase sind nicht mehr zulässig/);
  assert.match(deletePreviewRoute, /teamPlanningItemsV1Contract/);
  assert.match(deletePreviewHandler, /"write:planning-items:delete-empty"/);
  assert.match(deletePreviewHandler, /createEmptyEpicDeletePlanningItems/);
  assert.match(deletePreviewHandler, /mode: "preview"/);
  assert.match(updateRoute, /createTeamRevisePlanningItems/);
  assert.match(updateModule, /update_team_planning_item_with_projection_transaction/);
  assert.match(updateRoute, /createEmptyEpicDeletePlanningItems/);
  assert.doesNotMatch(updateRoute, /isEpicNotEmptyDatabaseError|loadEpicChildCounts/);
  assert.match(epicContract, /EPIC_NOT_EMPTY_CODE = "EPIC_NOT_EMPTY"/);
  assert.match(updateRoute, /team_planning_item_update_requests/);
  assert.match(updateRoute, /existingRequest/);
  assert.match(updateRoute, /replayCheck/);
  assert.match(updateRoute, /after\(/);
  assert.match(createHandler, /after\(/);
  assert.match(githubSyncRoute, /teamPlanningItemsV1Contract/);
  assert.match(githubSyncHandler, /"write:planning-items:github-sync"/);
  assert.match(githubSyncHandler, /githubSyncMode/);
  assert.match(githubSyncHandler, /idempotency-key/i);
  assert.match(githubSyncHandler, /randomUUID/);
  assert.match(tokensRoute, /create_team_planning_items_token_v3/);
  assert.match(tokensRoute, /allowUpdates/);
  assert.match(tokensRoute, /allowEmptyEpicDeletes/);
  assert.match(tokensRoute, /allowEmptyMilestoneDeletes/);
  assert.match(tokensRoute, /canIssueEmptyMilestoneDeletes/);
  assert.match(tokensRoute, /allowGitHubSync/);
  assert.match(tokensRoute, /Nur CEO oder Deputy/);
  assert.match(tokensRoute, /!payload \|\| typeof payload !== "object" \|\| Array\.isArray\(payload\)/);
  assert.match(tokensRoute, /Token-Payload muss ein JSON-Objekt sein/);
  assert.match(tokenUi, /canIssueEmptyEpicDeletes/);
  assert.match(tokenUi, /Leere Epics löschen/);
  assert.match(tokenUi, /GitHub synchronisieren/);
  assert.match(tokenRoute, /revoke_team_planning_items_token/);

  const document = JSON.parse(openapi);
  assert.equal(document.info.title, "FounderOps Planning Items API");
  assert.equal(document.info.version, "1.0.0");
  assert.deepEqual(Object.keys(document.paths), publicPaths);
  assert.equal(document.paths["/api/team/planning-items/v1/items/{id}"].patch.operationId, "updatePlanningItem");
  assert.equal(document.paths["/api/team/planning-items/v1/items/{id}"].delete.operationId, "deleteEmptyEpic");
  assert.equal(document.paths["/api/team/planning-items/v1/items/{id}/preview"].post.operationId, "previewPlanningItemUpdate");
  assert.equal(document.paths["/api/team/planning-items/v1/items/{id}/delete/preview"].post.operationId, "previewEmptyEpicDelete");
  assert.equal(document.paths["/api/team/planning-items/v1/tokens"].post.operationId, "createPlanningItemsToken");
  assert.equal(document.paths["/api/team/planning-items/v1/items/{id}/github-sync"].post.operationId, "syncPlanningItemToGitHub");
  assert.equal(document.paths["/api/team/planning-items/v1/items/{id}/github-sync"].post.parameters.length, 1);
  assert.equal(document.paths["/api/team/planning-items/v1/items/{id}"].patch.parameters[1].$ref, "#/components/parameters/IdempotencyKey");
  assert.equal(document.paths["/api/team/planning-items/v1/items/{id}"].delete.parameters[1].$ref, "#/components/parameters/IdempotencyKey");
  assert.equal(document.components.schemas.PlanningItemCreate.properties.itemType.enum[0], "epic");
  assert.deepEqual(document.components.schemas.PlanningItemCreate.properties.itemType.enum, ["epic", "initiative", "deliverable", "sub_issue", "milestone"]);
  assert.equal(document.components.schemas.PlanningItemCreate.properties.packageId.deprecated, true);
  assert.equal(document.components.schemas.PlanningItemCreate.properties.milestoneId.deprecated, true);
  assert.equal(document.components.schemas.PatchPayload.properties.packageId.deprecated, true);
  assert.equal(document.components.schemas.PatchPayload.properties.milestoneId.deprecated, true);
  assert.deepEqual(document.components.schemas.StrategicStatus.enum, ["Offen", "In Arbeit", "Pausiert", "Blockiert", "Erledigt"]);
  assert.deepEqual(document.components.schemas.TaskStatus.enum, ["Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt"]);
  assert.deepEqual(document.components.schemas.SubIssueStatus.enum, ["Offen", "In Arbeit", "Blockiert", "Erledigt"]);
  assert.deepEqual(document.components.schemas.PatchPayload.properties.status.oneOf, [
    { $ref: "#/components/schemas/StrategicStatus" },
    { $ref: "#/components/schemas/TaskStatus" },
    { $ref: "#/components/schemas/SubIssueStatus" },
  ]);
  assert.equal(document.components.schemas.CreateTokenPayload.properties.allowEmptyEpicDeletes.default, false);
  assert.equal(document.components.schemas.CreateTokenPayload.properties.allowEmptyMilestoneDeletes.deprecated, true);
  assert.equal(document.components.schemas.EpicNotEmptyResponse.properties.code.const, "MILESTONE_NOT_EMPTY");
  assert.equal(document.components.schemas.CreateTokenPayload.properties.allowGitHubSync.default, false);
  assert.deepEqual(document.components.schemas.GitHubSyncMode.enum, ["async", "wait"]);
  assert.equal(document.components.schemas.GitHubSyncCommand.properties.createIfMissing.type, "boolean");

  const v2Document = JSON.parse(v2Openapi);
  assert.equal(v2Document.info.version, "2.0.0");
  assert.deepEqual(Object.keys(v2Document.paths), v2PublicPaths);
  assert.deepEqual(v2Document.components.schemas.PlanningItemCreate.properties.itemType.enum, ["epic", "initiative", "deliverable", "sub_issue"]);
  assert.equal(v2Document.components.schemas.PlanningItemCreate.properties.milestoneId, undefined);
  assert.equal(v2Document.components.schemas.PlanningItemCreate.properties.packageId, undefined);
  assert.equal(v2Document.components.schemas.PatchPayload.properties.milestoneId, undefined);
  assert.equal(v2Document.components.schemas.PatchPayload.properties.packageId, undefined);
  assert.equal(v2Document.components.schemas.EpicNotEmptyResponse.properties.code.const, "EPIC_NOT_EMPTY");
  assert.match(apiContract, /allowLegacyAliases: false/);
  assert.match(apiContract, /allowLegacyItemIds: false/);
  assert.match(apiContract, /minimumReplayContractVersion: 2/);
  assert.match(contextModule, /planningItemsV2Context/);
  assert.match(contextModule, /initiatives: context\.items\.filter/);
  assert.match(documentation, /PATCH processes only properties present/);
  assert.match(documentation, /write:planning-items:delete-empty/);
  assert.match(documentation, /write:planning-items:github-sync/);
  assert.match(documentation, /GitHub projection is intentionally unavailable for Epics and Initiatives/);
  assert.match(documentation, /valid: false/);
  assert.match(documentation, /V1 continues to normalize deprecated request fields/);
  assert.match(documentation, /parentTaskId.*hierarchy reference/);
  assert.match(documentation, /Review, score, Evidence gates, Sprint, repository, or GitHub fields/);
  assert.match(documentation, /Sub-Issues retain their separate four-state status contract/);
  assert.match(documentation, /\/api\/team\/planning-items\/v2/);
  assert.match(documentation, /V2 rejects the deprecated `milestone`/);
  assert.match(documentation, /EPIC_NOT_EMPTY/);
});

test("v1 create compatibility and v2 canonical create behavior differ at the shared handler", async () => {
  let runnerCalls = 0;
  const handler = await loadTranspiledModule(
    "src/features/planning-items/model/planning-items-team-create-route.ts",
    {
      "next/server": { after: () => undefined },
      "@/lib/api-input": { auditRequestMetadata: () => ({}) },
      "@/features/planning-items/model/planning-actor-context-server": {
        actorContextFromPlanningTokenAuth: () => ({
          ok: true,
          actor: { profileId: "ceo", platformRole: "ceo", credential: { kind: "planningToken", tokenId: "token", scopes: [] } },
        }),
      },
      "@/features/planning-items/model/planning-items-contract": { isUuid: () => true },
      "@/features/planning-items/model/planning-items-create": {
        parsePlanningItemCreatePayload: () => ({
          ok: true,
          items: [{ itemType: "milestone", title: "Legacy", packageId: "package-1" }],
          githubSyncMode: null,
          hasLegacyAliases: true,
        }),
        planningItemCreateRequiresOperationalLead: () => true,
        planningItemCreateCommand: () => ({ kind: "createItems", items: [] }),
        createTeamCreatePlanningItems: ({ onPreview }) => ({
          run: async () => {
            runnerCalls += 1;
            onPreview?.([{ errors: [] }]);
            return { ok: true, status: "preview", items: [], changes: [], effects: [] };
          },
        }),
      },
      "@/features/planning-items/model/planning-items-github-projection": {},
      "@/features/planning-items/model/planning-items-route": {
        handlePlanningItemsRequest: async (_request, _scope, _message, callback) => callback({
          tokenId: "token",
          scopes: [],
          profile: { id: "ceo", platformRole: "ceo" },
          supabase: {},
        }),
        planningItemsError: (error, status) => ({ status, body: { ok: false, error } }),
        planningItemsJson: (body, status = 200) => ({ status, body }),
      },
      "@/features/planning-items/model/planning-items-team-api-contract": {
        canonicalTeamApiError: "canonical v2 only",
      },
    },
  );
  const request = { json: async () => ({ items: [{ itemType: "milestone" }] }) };
  const v1 = { version: "v1", allowLegacyAliases: true, allowLegacyItemIds: true, minimumReplayContractVersion: 1 };
  const v2 = { version: "v2", allowLegacyAliases: false, allowLegacyItemIds: false, minimumReplayContractVersion: 2 };

  const v1Response = await handler.handleTeamPlanningItemsCreatePreview(request, v1);
  assert.equal(v1Response.status, 200);
  assert.equal(runnerCalls, 1);
  const v2Response = await handler.handleTeamPlanningItemsCreatePreview(request, v2);
  assert.equal(v2Response.status, 400);
  assert.equal(v2Response.body.error, "canonical v2 only");
  assert.equal(runnerCalls, 1);
});

test("v2 context projection removes every v1 alias and derives initiatives from items", async () => {
  const contextModule = await loadTranspiledModule(
    "src/features/planning-items/model/planning-items-context.ts",
    {
      "@/lib/status": { normalizeStatus: (value) => value, normalizeSubIssueStatus: (value) => value },
      "@/features/planning-items/model/planning-items-contract": {},
      "@/features/planning-items/model/supabase-pagination": {},
      "@/lib/planning-read-model": {},
    },
  );
  const initiative = {
    id: "initiative-1",
    itemType: "initiative",
    strategy: { goal: "Goal", scopeConstraints: "Scope", successCriteria: "Success" },
  };
  const projected = contextModule.planningItemsV2Context({
    actor: { id: "ceo" },
    constraints: {},
    profiles: [],
    items: [initiative, { id: "deliverable-1", itemType: "deliverable" }],
    epics: [],
    initiatives: [{ ...initiative, goal: "Compatibility goal" }],
    tasks: [],
    milestones: [{ id: "legacy-epic" }],
    sprints: [],
  });

  assert.equal(Object.hasOwn(projected, "milestones"), false);
  assert.deepEqual(projected.initiatives, [initiative]);
  assert.equal(Object.hasOwn(projected.initiatives[0], "goal"), false);
  assert.equal(Object.hasOwn(projected.initiatives[0], "successCriteria"), false);
  assert.equal(projected.initiatives[0].strategy.goal, "Goal");
});

test("GitHub sync scope migration backfills only active tokens and keeps issuance explicit", async () => {
  const migration = await read("supabase/migrations/20260728181747_planning_items_github_sync_scope.sql");
  assert.match(migration, /write:planning-items:github-sync/);
  assert.match(migration, /where revoked_at is null\s+and expires_at > now\(\)/i);
  assert.match(migration, /create or replace function public\.create_team_planning_items_token_v3/i);
  assert.match(migration, /p_allow_github_sync boolean default false/i);
  assert.match(migration, /grant execute on function public\.create_team_planning_items_token_v3[^]*to service_role/i);
  assert.doesNotMatch(migration, /grant execute[^]*to anon/i);
});

test("legacy public Team Task Intake routes and source modules are absent", async () => {
  for (const path of [
    "src/app/(workspaces)/ceo-intake/page.tsx",
    "src/app/(workspaces)/ceo-intake/loading.tsx",
    "src/app/api/ceo/task-intake/preview/route.ts",
    "src/app/api/ceo/task-intake/commit/route.ts",
    "src/app/api/team/task-context/route.ts",
    "src/app/api/team/task-intake/v2/preview/route.ts",
    "src/app/api/team/task-intake/v2/commit/route.ts",
    "src/app/api/team/task-intake-tokens/route.ts",
    "src/features/intake/organisms/ceo-task-intake.tsx",
    "src/features/intake/model/task-intake-api-client.ts",
    "src/features/intake/model/task-intake-commit.ts",
    "src/features/intake/model/task-intake-context.ts",
    "src/features/intake/model/task-intake-route.ts",
    "src/features/intake/model/task-intake.ts",
    "src/features/intake/model/team-task-intake-contract.ts",
    "src/features/intake/model/team-task-intake-v2.ts",
  ]) {
    await assert.rejects(access(new URL(path, root)));
  }
});

test("PATCH implementation keeps type-specific fields, compare-and-set, idempotency, and task status transitions explicit", async () => {
  const [updateModel, migration, statusMigration, routeContract] = await Promise.all([
    read("src/features/planning-items/model/planning-item-update.ts"),
    read("supabase/migrations/20260713182811_planning_items_api_updates.sql"),
    read("supabase/migrations/20260722115153_planning_items_task_status_updates.sql"),
    read("src/features/planning-items/model/planning-items-route.ts"),
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
  assert.match(updateModel, /validateTaskStatusUpdate/);
  assert.match(updateModel, /validateSubIssueStatusParentApproval/);
  assert.match(updateModel, /startsTaskReviewRequest/);
  assert.match(updateModel, /Review Owner wird über die Review-Anfrage benachrichtigt/);
  assert.match(statusMigration, /write:planning-items:update/);
  assert.match(statusMigration, /deliverable final status requires ceo/);
  assert.match(statusMigration, /sub-issue parent is not approved/);
  assert.match(statusMigration, /review requires approved deliverable/);
  assert.match(statusMigration, /sprint score is locked/);
  assert.match(statusMigration, /insert into public\.task_activity/);
  assert.match(statusMigration, /insert into public\.notification_events/);
  assert.match(statusMigration, /'team\.planning_items\.update'/);
  assert.match(statusMigration, /github_issue_sync_status', 'not_synced'/);
  assert.match(statusMigration, /update_team_planning_item_transaction_without_task_status[^]*from public, anon, authenticated, service_role/);
  assert.match(routeContract, /\["P0008", "P0010"\]/);
});

test("PATCH normalizers preserve explicit zeroes and clear only fields supplied as null or blank", async () => {
  const normalizers = await loadTranspiledModule(
    "src/features/planning-items/model/planning-item-normalization.ts",
    {
      "@/lib/api-input": {
        cleanText: (value, maxLength) => String(value || "").trim().slice(0, maxLength),
      },
      "@/lib/slug": { normalizeLookup: (value) => value, slugify: (value) => value },
      "@/features/planning-items/model/planning-items-contract": {
        PLANNING_ITEM_FIELD_RULES: {},
        TEAM_PLANNING_TASK_STATUSES: ["Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt"],
      },
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
  assert.deepEqual(normalizers.normalizePatchTaskStatus("Review"), { ok: true, value: "Review" });
  assert.equal(normalizers.normalizePatchTaskStatus("planned").ok, false);
});

test("Epic delete and legacy compatibility helpers enforce role, version, and stable idempotency input", async () => {
  const contract = await loadTranspiledModule("src/features/planning-items/model/planning-items-contract.ts");
  const normalization = await loadTranspiledModule(
    "src/features/planning-items/model/planning-item-normalization.ts",
    {
      "@/lib/api-input": {
        cleanText: (value, maxLength) => String(value || "").trim().slice(0, maxLength),
      },
      "@/lib/slug": { normalizeLookup: (value) => value, slugify: (value) => value },
      "@/features/planning-items/model/planning-items-contract": contract,
    },
  );
  const create = await loadTranspiledModule(
    "src/features/planning-items/model/planning-items-create.ts",
    {
      "@/lib/planning-read-model": { ACTIVE_PACKAGES_TABLE: "active_packages", ACTIVE_TASKS_TABLE: "active_tasks" },
      "@/lib/github-repositories": {
        defaultGitHubRepository: "findmydoc-platform/management",
        resolveTaskGitHubRepository: () => ({ ok: true, repository: "findmydoc-platform/management" }),
      },
      "@/features/planning-items/model/planning-items-contract": contract,
      "@/features/planning-items/model/planning-item-normalization": normalization,
      "@/features/reviews/model/task-review-state": {
        isReviewStateLocked: () => false,
        reviewStateLockMessage: () => "Review locked",
      },
      "@/features/planning-items/model/planning-items-github-sync-preview": {
        previewPlanningItemGitHubSync: () => ({ status: "accepted" }),
      },
    },
  );
  assert.equal(create.planningItemCreateRequiresOperationalLead([{ itemType: "milestone" }]), true);
  assert.equal(create.planningItemCreateRequiresOperationalLead([{ itemType: "epic" }]), true);
  assert.equal(create.planningItemCreateRequiresOperationalLead([{ itemType: "deliverable" }]), false);
  const legacyType = create.parsePlanningItemCreatePayload({ items: [{ itemType: "milestone", title: "Launch", targetDate: "2026-10-31", status: "planned" }] });
  assert.equal(legacyType.ok, true);
  assert.equal(legacyType.hasLegacyAliases, true);
  const legacyParent = create.parsePlanningItemCreatePayload({ items: [{ itemType: "deliverable", title: "Launch", packageId: "legacy-package" }] });
  assert.equal(legacyParent.ok, true);
  assert.equal(legacyParent.hasLegacyAliases, true);
  const canonical = create.parsePlanningItemCreatePayload({ items: [{ itemType: "deliverable", title: "Launch", parentTaskId: "initiative" }] });
  assert.equal(canonical.ok, true);
  assert.equal(canonical.hasLegacyAliases, false);
  assert.equal(create.parsePlanningItemCreatePayload({ items: [{ itemType: "milestone", title: "Launch", sortOrder: 2 }] }).ok, false);

  const query = (data) => ({
    eq() { return this; },
    then(resolve, reject) { return Promise.resolve({ data, error: null }).then(resolve, reject); },
  });
  const rowsByTable = { profiles: [{ id: "ceo", name: "CEO" }], planning_item_legacy_ids: [], active_tasks: [] };
  const supabase = { from: (table) => ({ select: () => query(rowsByTable[table] || []) }) };
  const [epicPreview] = await create.buildPlanningItemCreatePreview(
    [{ itemType: "epic", title: " Launch ", description: " Ready ", ownerId: "ceo", targetDate: "2026-10-31", status: "In Arbeit" }],
    { id: "ceo", name: "CEO", platformRole: "ceo", githubLogin: "" },
    supabase,
  );
  assert.deepEqual(epicPreview, {
    clientId: "planning-items-create-1",
    itemType: "epic",
    title: "Launch",
    description: "Ready",
    parentTaskId: "",
    ownerId: "ceo",
    targetDate: "2026-10-31",
    status: "In Arbeit",
    approvalStatus: null,
    errors: [],
    warnings: [],
  });

  rowsByTable.profiles = [{ id: "founder", name: "Founder" }];
  rowsByTable.active_tasks = [{
    id: "deliverable-parent",
    title: "Parent",
    task_type: "deliverable",
    approval_status: "approved",
    review_status: "not_requested",
    score_final: false,
  }];
  const [subIssuePreview] = await create.buildPlanningItemCreatePreview(
    [{
      itemType: "sub_issue",
      title: " Confirm rollout ",
      description: " Coordinate the date. ",
      parentTaskId: "deliverable-parent",
      githubRepo: "findmydoc-platform/management",
    }],
    { id: "founder", name: "Founder", platformRole: "founder", githubLogin: "" },
    supabase,
  );
  assert.deepEqual(subIssuePreview, {
    clientId: "planning-items-create-1",
    itemType: "sub_issue",
    title: "Confirm rollout",
    description: "Coordinate the date.",
    problemStatement: "",
    intendedOutcome: "",
    scopeConstraints: "",
    acceptanceCriteria: "",
    evidenceRequired: "",
    definitionOfDone: "",
    parentTaskId: "deliverable-parent",
    ownerId: "founder",
    githubRepo: "findmydoc-platform/management",
    status: "Offen",
    approvalStatus: null,
    scoreRelevant: false,
    errors: [],
    warnings: [],
  });

  const [briefSubIssuePreview] = await create.buildPlanningItemCreatePreview(
    [{
      itemType: "sub_issue",
      title: "Confirm rollout",
      parentTaskId: "deliverable-parent",
      problemStatement: "Clarify the rollout window.",
      intendedOutcome: "A confirmed date.",
      scopeConstraints: "Only the date.",
      acceptanceCriteria: ["Date is confirmed"],
      evidenceRequired: "Calendar invite",
      definitionOfDone: "The owner has informed the team.",
    }],
    { id: "founder", name: "Founder", platformRole: "founder", githubLogin: "" },
    supabase,
  );
  assert.deepEqual(
    {
      problemStatement: briefSubIssuePreview.problemStatement,
      intendedOutcome: briefSubIssuePreview.intendedOutcome,
      scopeConstraints: briefSubIssuePreview.scopeConstraints,
      acceptanceCriteria: briefSubIssuePreview.acceptanceCriteria,
      evidenceRequired: briefSubIssuePreview.evidenceRequired,
      definitionOfDone: briefSubIssuePreview.definitionOfDone,
    },
    {
      problemStatement: "Clarify the rollout window.",
      intendedOutcome: "A confirmed date.",
      scopeConstraints: "Only the date.",
      acceptanceCriteria: "Date is confirmed",
      evidenceRequired: "Calendar invite",
      definitionOfDone: "The owner has informed the team.",
    },
  );
  assert.deepEqual(briefSubIssuePreview.errors, []);

});
