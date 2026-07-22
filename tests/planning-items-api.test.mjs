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
  "/api/team/planning-items/v1/tokens",
  "/api/team/planning-items/v1/tokens/{id}",
];

test("Planning Items API exposes create, PATCH, and empty Milestone DELETE contracts", async () => {
  const [contract, milestoneContract, contextRoute, createPreviewRoute, createRoute, updatePreviewRoute, deletePreviewRoute, updateRoute, tokensRoute, tokenRoute, tokenUi, openapi, documentation] = await Promise.all([
    read("src/features/planning-items/model/planning-items-contract.ts"),
    read("src/features/projects/model/milestone-contract.ts"),
    read("src/app/api/team/planning-items/v1/context/route.ts"),
    read("src/app/api/team/planning-items/v1/items/preview/route.ts"),
    read("src/app/api/team/planning-items/v1/items/route.ts"),
    read("src/app/api/team/planning-items/v1/items/[id]/preview/route.ts"),
    read("src/app/api/team/planning-items/v1/items/[id]/delete/preview/route.ts"),
    read("src/app/api/team/planning-items/v1/items/[id]/route.ts"),
    read("src/app/api/team/planning-items/v1/tokens/route.ts"),
    read("src/app/api/team/planning-items/v1/tokens/[id]/route.ts"),
    read("src/features/profile/organisms/profile-planning-items-tokens.tsx"),
    read("public/founderops-team-planning-items-openapi.json"),
    read("docs/team-planning-items-api.md"),
  ]);

  assert.match(contract, /"read:planning-context"/);
  assert.match(contract, /"write:planning-items:create"/);
  assert.match(contract, /"write:planning-items:update"/);
  assert.match(contract, /"write:planning-items:delete-empty"/);
  assert.match(contract, /"milestone"/);
  assert.match(contextRoute, /"read:planning-context"/);
  assert.match(createPreviewRoute, /"write:planning-items:create"/);
  assert.match(createRoute, /create_team_planning_items_transaction/);
  assert.match(updatePreviewRoute, /"write:planning-items:update"/);
  assert.match(deletePreviewRoute, /"write:planning-items:delete-empty"/);
  assert.match(deletePreviewRoute, /loadPlanningItemMilestoneDeletePreview/);
  assert.match(updateRoute, /update_team_planning_item_transaction/);
  assert.match(updateRoute, /delete_team_planning_milestone_transaction/);
  assert.match(updateRoute, /isMilestoneNotEmptyDatabaseError/);
  assert.match(updateRoute, /milestoneNotEmptyError/);
  assert.match(milestoneContract, /MILESTONE_NOT_EMPTY_CODE = "MILESTONE_NOT_EMPTY"/);
  assert.match(updateRoute, /team_planning_item_update_requests/);
  assert.match(updateRoute, /existingRequest/);
  assert.match(updateRoute, /replayCheck/);
  assert.match(tokensRoute, /create_team_planning_items_token_v2/);
  assert.match(tokensRoute, /allowUpdates/);
  assert.match(tokensRoute, /allowEmptyMilestoneDeletes/);
  assert.match(tokensRoute, /Nur CEO oder Deputy/);
  assert.match(tokensRoute, /!payload \|\| typeof payload !== "object" \|\| Array\.isArray\(payload\)/);
  assert.match(tokensRoute, /Token-Payload muss ein JSON-Objekt sein/);
  assert.match(tokenUi, /canIssueEmptyMilestoneDeletes/);
  assert.match(tokenUi, /Leere Meilensteine löschen/);
  assert.match(tokenRoute, /revoke_team_planning_items_token/);

  const document = JSON.parse(openapi);
  assert.equal(document.info.title, "FounderOps Planning Items API");
  assert.equal(document.info.version, "1.2.0");
  assert.deepEqual(Object.keys(document.paths), publicPaths);
  assert.equal(document.paths["/api/team/planning-items/v1/items/{id}"].patch.operationId, "updatePlanningItem");
  assert.equal(document.paths["/api/team/planning-items/v1/items/{id}"].delete.operationId, "deleteEmptyMilestone");
  assert.equal(document.paths["/api/team/planning-items/v1/items/{id}/preview"].post.operationId, "previewPlanningItemUpdate");
  assert.equal(document.paths["/api/team/planning-items/v1/items/{id}/delete/preview"].post.operationId, "previewEmptyMilestoneDelete");
  assert.equal(document.paths["/api/team/planning-items/v1/tokens"].post.operationId, "createPlanningItemsToken");
  assert.equal(document.paths["/api/team/planning-items/v1/items/{id}"].patch.parameters[1].$ref, "#/components/parameters/IdempotencyKey");
  assert.equal(document.paths["/api/team/planning-items/v1/items/{id}"].delete.parameters[1].$ref, "#/components/parameters/IdempotencyKey");
  assert.equal(document.components.schemas.PlanningItemCreate.properties.itemType.enum[0], "milestone");
  assert.deepEqual(document.components.schemas.TaskStatus.enum, ["Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt"]);
  assert.deepEqual(document.components.schemas.PatchPayload.properties.status.oneOf, [
    { $ref: "#/components/schemas/MilestoneStatus" },
    { $ref: "#/components/schemas/TaskStatus" },
  ]);
  assert.equal(document.components.schemas.CreateTokenPayload.properties.allowEmptyMilestoneDeletes.default, false);
  assert.match(documentation, /PATCH processes only properties that are present/);
  assert.match(documentation, /write:planning-items:delete-empty/);
  assert.match(documentation, /valid: false/);
  assert.match(documentation, /No legacy HTTP aliases are retained/);
  assert.match(documentation, /Existing update-enabled tokens continue to work without rotation/);
  assert.match(documentation, /status: "Review"/);
  assert.match(documentation, /complete any Sub-Issue/);
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
        TEAM_PLANNING_MILESTONE_STATUSES: ["planned", "active", "done"],
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
  assert.deepEqual(normalizers.normalizePatchMilestoneStatus("active"), { ok: true, value: "active" });
  assert.equal(normalizers.normalizePatchMilestoneStatus("archived").ok, false);
  assert.deepEqual(normalizers.normalizePatchTaskStatus("Review"), { ok: true, value: "Review" });
  assert.equal(normalizers.normalizePatchTaskStatus("planned").ok, false);
});

test("Milestone create and delete payload helpers enforce role, version, and stable idempotency input", async () => {
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
        REVIEW_LOCKED_MESSAGE: "Review locked",
      },
    },
  );
  const deletion = await loadTranspiledModule(
    "src/features/planning-items/model/planning-item-delete.ts",
    {
      "@/features/planning-items/model/planning-items-contract": contract,
      "@/features/planning-items/model/planning-item-update": { mapPlanningItemDatabaseRow: () => ({}) },
      "@/features/projects/model/milestone-contract": {},
      "@/features/projects/model/milestone-server": {
        parseMilestoneDeleteRequest: (payload) => {
          if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
            return { ok: false, error: "Ungültiger JSON-Body." };
          }
          const fields = Object.keys(payload);
          if (fields.some((field) => field !== "expectedUpdatedAt")) {
            return { ok: false, error: "Unbekanntes Feld." };
          }
          if (typeof payload.expectedUpdatedAt !== "string" || Number.isNaN(Date.parse(payload.expectedUpdatedAt))) {
            return { ok: false, error: "expectedUpdatedAt muss ein gültiger Zeitstempel sein." };
          }
          return { ok: true, value: { expectedUpdatedAt: payload.expectedUpdatedAt } };
        },
        loadProjectMilestone: (supabase, id) => supabase
          .from("milestones")
          .select("id,project_id,title,description,target_date,status,sort_order,updated_at")
          .eq("project_id", "findmydoc-founder-execution")
          .eq("id", id)
          .maybeSingle(),
        loadMilestoneChildCounts: async (supabase, id) => {
          const [initiatives, tasks] = await Promise.all([
            supabase.from("packages").select("id", { count: "exact", head: true }).eq("milestone_id", id),
            supabase.from("tasks").select("id", { count: "exact", head: true }).eq("milestone_id", id),
          ]);
          return {
            ok: true,
            counts: { initiatives: initiatives.count || 0, tasks: tasks.count || 0 },
          };
        },
        milestoneNotEmptyError: (children) => ({
          code: "MILESTONE_NOT_EMPTY",
          error: "Der Meilenstein kann nicht gelöscht werden, weil noch Kinder zugeordnet sind.",
          children,
        }),
      },
    },
  );

  assert.equal(create.planningItemCreateRequiresOperationalLead([{ itemType: "milestone" }]), true);
  assert.equal(create.planningItemCreateRequiresOperationalLead([{ itemType: "deliverable" }]), false);
  assert.equal(create.parsePlanningItemCreatePayload({ items: [{ itemType: "milestone", title: "Launch", targetDate: "2026-10-31", status: "planned" }] }).ok, true);
  assert.equal(create.parsePlanningItemCreatePayload({ items: [{ itemType: "milestone", title: "Launch", sortOrder: 2 }] }).ok, false);

  const query = (data) => ({
    eq() { return this; },
    then(resolve, reject) { return Promise.resolve({ data, error: null }).then(resolve, reject); },
  });
  const rowsByTable = { profiles: [], active_packages: [], milestones: [], active_tasks: [] };
  const supabase = { from: (table) => ({ select: () => query(rowsByTable[table] || []) }) };
  const [milestonePreview] = await create.buildPlanningItemCreatePreview(
    [{ itemType: "milestone", title: " Launch ", description: " Ready ", targetDate: "2026-10-31", status: "active" }],
    { id: "ceo", name: "CEO", platformRole: "ceo", githubLogin: "" },
    supabase,
  );
  assert.deepEqual(milestonePreview, {
    clientId: "planning-items-create-1",
    itemType: "milestone",
    title: "Launch",
    description: "Ready",
    targetDate: "2026-10-31",
    status: "active",
    approvalStatus: null,
    errors: [],
    warnings: [],
  });

  const expectedUpdatedAt = "2026-07-14T12:00:00.000Z";
  assert.deepEqual(deletion.parsePlanningItemDeletePayload({ expectedUpdatedAt }), { ok: true, expectedUpdatedAt });
  assert.equal(deletion.parsePlanningItemDeletePayload({ expectedUpdatedAt, moveChildren: true }).ok, false);
  assert.equal(deletion.parsePlanningItemDeletePayload({}).ok, false);
  assert.equal(
    deletion.planningItemMilestoneDeleteHash({ itemId: "milestone-a", expectedUpdatedAt }),
    deletion.planningItemMilestoneDeleteHash({ itemId: "milestone-a", expectedUpdatedAt }),
  );
  assert.notEqual(
    deletion.planningItemMilestoneDeleteHash({ itemId: "milestone-a", expectedUpdatedAt }),
    deletion.planningItemMilestoneDeleteHash({ itemId: "milestone-b", expectedUpdatedAt }),
  );

  const countQuery = (count) => ({
    eq() { return this; },
    then(resolve, reject) { return Promise.resolve({ data: null, count, error: null }).then(resolve, reject); },
  });
  const deleteSupabase = {
    from(table) {
      if (table === "milestones") {
        const builder = {
          eq() { return this; },
          maybeSingle: async () => ({
            data: { id: "milestone-a", updated_at: expectedUpdatedAt },
            error: null,
          }),
        };
        return { select: () => builder };
      }
      return { select: () => countQuery(table === "packages" ? 2 : 5) };
    },
  };
  const blockedPreview = await deletion.loadPlanningItemMilestoneDeletePreview({
    actor: { id: "ceo", name: "CEO", platformRole: "ceo", githubLogin: "" },
    itemId: "milestone-a",
    expectedUpdatedAt,
    supabase: deleteSupabase,
  });
  assert.equal(blockedPreview.ok, true);
  assert.equal(blockedPreview.preview.valid, false);
  assert.equal(blockedPreview.preview.canDelete, false);
  assert.equal(blockedPreview.preview.code, "MILESTONE_NOT_EMPTY");
  assert.deepEqual(blockedPreview.preview.children, { initiatives: 2, tasks: 5 });
  assert.deepEqual(
    await deletion.loadPlanningItemMilestoneDeletePreview({
      actor: { id: "founder", name: "Founder", platformRole: "founder", githubLogin: "" },
      itemId: "milestone-a",
      expectedUpdatedAt,
      supabase: deleteSupabase,
    }),
    { ok: false, status: 403, error: "Nur CEO oder Deputy können Meilensteine löschen." },
  );
});
