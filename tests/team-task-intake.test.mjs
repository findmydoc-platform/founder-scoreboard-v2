import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

const initiativeContextFields = [
  "id",
  "title",
  "milestoneId",
  "ownerId",
  "accountableProfileId",
  "responsibleProfileIds",
  "status",
  "priority",
  "targetDate",
  "approvalStatus",
  "goal",
  "scopeConstraints",
  "successCriteria",
];

const initiativeContextSelect = [
  "id",
  "title",
  "milestone_id",
  "owner_id",
  "accountable_profile_id",
  "responsible_profile_ids",
  "status",
  "priority",
  "target_date",
  "sort_order",
  "approval_status",
  "goal",
  "scope_constraints",
  "success_criteria",
].join(",");

test("Team Task Intake exposes only the approval-aware v2 contract", async () => {
  const [contract, context, contextRoute, v2Preview, v2Commit, openapi, documentation] = await Promise.all([
    read("src/features/intake/model/team-task-intake-contract.ts"),
    read("src/features/intake/model/team-task-context.ts"),
    read("src/app/api/team/task-context/route.ts"),
    read("src/app/api/team/task-intake/v2/preview/route.ts"),
    read("src/app/api/team/task-intake/v2/commit/route.ts"),
    read("public/founderops-team-intake-openapi.json"),
    read("docs/team-task-intake-api.md"),
  ]);

  assert.match(contract, /TEAM_TASK_INTAKE_ALLOWED_ITEM_TYPES = \["initiative", "deliverable", "sub_issue"\]/);
  assert.match(contract, /TEAM_TASK_INTAKE_SCOPES = \["read:task-context", "write:task-intake"\]/);
  assert.match(context, /allowedItemTypes: TEAM_TASK_INTAKE_ALLOWED_ITEM_TYPES/);
  assert.match(context, /subIssuePolicy: "any-deliverable"/);
  assert.match(contextRoute, /handleTeamTaskIntakeRequest\(request, "read:task-context"/);
  assert.match(v2Preview, /handleTeamTaskIntakeRequest\(request, "write:task-intake"/);
  assert.match(v2Commit, /handleTeamTaskIntakeRequest\(request, "write:task-intake"/);
  assert.match(v2Preview, /buildTeamTaskIntakeV2Preview/);
  assert.match(v2Commit, /create_team_task_intake_v2_transaction/);

  const document = JSON.parse(openapi);
  assert.equal(document.info.version, "2.1.0");
  assert.deepEqual(Object.keys(document.paths), [
    "/api/team/task-context",
    "/api/team/task-intake/v2/preview",
    "/api/team/task-intake/v2/commit",
  ]);
  assert.ok(document.paths["/api/team/task-intake/v2/preview"]);
  assert.ok(document.paths["/api/team/task-intake/v2/commit"]);
  assert.equal(document.paths["/api/team/task-intake/preview"], undefined);
  assert.equal(document.paths["/api/team/task-intake/commit"], undefined);
  assert.equal(document.paths["/api/team/task-context"].get.operationId, "getTeamTaskContext");
  assert.equal(document.paths["/api/team/task-intake/v2/preview"].post.operationId, "previewTeamTaskIntakeV2");
  assert.equal(document.paths["/api/team/task-intake/v2/commit"].post.operationId, "commitTeamTaskIntakeV2");
  assert.equal(
    document.paths["/api/team/task-intake/v2/preview"].post.requestBody.content["application/json"].schema.$ref,
    "#/components/schemas/TeamTaskIntakeV2Payload",
  );
  assert.equal(
    document.paths["/api/team/task-intake/v2/commit"].post.requestBody.content["application/json"].schema.$ref,
    "#/components/schemas/TeamTaskIntakeV2Payload",
  );
  assert.equal(
    document.paths["/api/team/task-intake/v2/preview"].post.responses["200"].content["application/json"].schema.$ref,
    "#/components/schemas/PreviewResponse",
  );
  assert.equal(
    document.paths["/api/team/task-intake/v2/commit"].post.responses["200"].content["application/json"].schema.$ref,
    "#/components/schemas/CommitResponse",
  );
  assert.deepEqual(document.components.schemas.TeamTaskIntakeV2Item.properties.itemType.enum, ["initiative", "deliverable", "sub_issue"]);
  assert.match(documentation, /includes an Initiative brief for every entry in `context\.initiatives`/);
  assert.match(documentation, /does not perform server-side matching or recommendations/);
});

test("Team Task Context maps complete Initiative briefs from the exact safe projection", async () => {
  const initiativeModule = await loadTranspiledModule(
    "src/features/intake/model/team-task-context-initiative.ts",
  );
  const paginationModule = await loadTranspiledModule(
    "src/features/intake/model/supabase-pagination.ts",
  );
  const contextModule = await loadTranspiledModule(
    "src/features/intake/model/team-task-context.ts",
    {
      "@/lib/status": { normalizeStatus: (status) => status || "Offen" },
      "@/features/intake/model/team-task-intake-contract": {
        TEAM_TASK_INTAKE_ALLOWED_ITEM_TYPES: ["initiative", "deliverable", "sub_issue"],
        TEAM_TASK_INTAKE_FORBIDDEN_WRITES: ["approval"],
        TEAM_TASK_INTAKE_MAX_TASKS: 30,
      },
      "@/features/intake/model/team-task-context-initiative": initiativeModule,
      "@/features/intake/model/supabase-pagination": paginationModule,
      "@/lib/planning-read-model": {
        ACTIVE_PACKAGES_TABLE: "active_packages",
        ACTIVE_TASKS_TABLE: "active_tasks",
      },
    },
  );
  const packageRow = {
    id: "initiative-1",
    title: "Improve onboarding",
    milestone_id: "milestone-1",
    owner_id: "profile-owner",
    accountable_profile_id: "profile-accountable",
    responsible_profile_ids: ["profile-responsible"],
    status: "planned",
    priority: "P2",
    target_date: "2026-09-30",
    sort_order: 1,
    approval_status: "approved",
    goal: "Make onboarding reliable.",
    scope_constraints: "Keep the existing identity provider.",
    success_criteria: "New users complete onboarding without support.",
  };
  const selectedColumns = new Map();
  const rowsByTable = new Map([
    ["active_packages", [packageRow]],
  ]);
  const supabase = {
    from(table) {
      const query = {
        select(columns) {
          selectedColumns.set(table, columns);
          return query;
        },
        order() { return query; },
        range() {
          return Promise.resolve({ data: rowsByTable.get(table) || [], error: null });
        },
      };
      return query;
    },
  };

  const result = await contextModule.buildTeamTaskContext(supabase, {
    id: "profile-actor",
    name: "Test Actor",
    platformRole: "founder",
  });

  assert.equal(initiativeModule.TEAM_TASK_CONTEXT_INITIATIVE_SELECT, initiativeContextSelect);
  assert.equal(selectedColumns.get("active_packages"), initiativeContextSelect);
  assert.deepEqual(Object.keys(result.initiatives[0]), initiativeContextFields);
  assert.deepEqual(result.initiatives[0], {
    id: "initiative-1",
    title: "Improve onboarding",
    milestoneId: "milestone-1",
    ownerId: "profile-owner",
    accountableProfileId: "profile-accountable",
    responsibleProfileIds: ["profile-responsible"],
    status: "planned",
    priority: "P2",
    targetDate: "2026-09-30",
    approvalStatus: "approved",
    goal: "Make onboarding reliable.",
    scopeConstraints: "Keep the existing identity provider.",
    successCriteria: "New users complete onboarding without support.",
  });
  for (const forbiddenField of ["decisionNote", "token", "comments", "proposedById", "decidedById"]) {
    assert.equal(Object.hasOwn(result.initiatives[0], forbiddenField), false);
  }
});

test("Team Task Context normalizes empty Initiative brief values and documents the complete schema", async () => {
  const { mapTeamTaskContextInitiative } = await loadTranspiledModule(
    "src/features/intake/model/team-task-context-initiative.ts",
  );
  const emptyBriefRow = {
    id: "initiative-empty",
    title: "Empty brief",
    milestone_id: null,
    owner_id: null,
    accountable_profile_id: null,
    responsible_profile_ids: null,
    status: null,
    priority: null,
    target_date: null,
    sort_order: 2,
    approval_status: null,
    goal: null,
    scope_constraints: null,
    success_criteria: null,
  };
  const emptyBrief = mapTeamTaskContextInitiative(emptyBriefRow);
  assert.equal(emptyBrief.approvalStatus, "approved");
  assert.equal(emptyBrief.goal, "");
  assert.equal(emptyBrief.scopeConstraints, "");
  assert.equal(emptyBrief.successCriteria, "");
  for (const approvalStatus of ["draft", "proposed", "approved", "rejected"]) {
    assert.equal(mapTeamTaskContextInitiative({ ...emptyBriefRow, approval_status: approvalStatus }).approvalStatus, approvalStatus);
  }

  const document = JSON.parse(await read("public/founderops-team-intake-openapi.json"));
  const schema = document.components.schemas.TeamTaskContextInitiative;
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, initiativeContextFields);
  assert.deepEqual(Object.keys(schema.properties), initiativeContextFields);
  assert.deepEqual(schema.properties.approvalStatus.enum, ["draft", "proposed", "approved", "rejected"]);
  assert.equal(schema.properties.goal.type, "string");
  assert.equal(schema.properties.scopeConstraints.type, "string");
  assert.equal(schema.properties.successCriteria.type, "string");
  assert.equal(
    document.components.schemas.TeamTaskContextResponse.properties.context.properties.initiatives.items.$ref,
    "#/components/schemas/TeamTaskContextInitiative",
  );
});

test("legacy Team Task Intake routes and parsers are absent", async () => {
  for (const path of [
    "src/app/api/team/task-intake/preview/route.ts",
    "src/app/api/team/task-intake/commit/route.ts",
    "src/features/intake/model/team-task-intake.ts",
    "src/features/intake/model/team-task-intake-policy.ts",
    "src/features/intake/model/team-task-intake-commit.ts",
  ]) {
    await assert.rejects(access(new URL(path, root)));
  }
});

test("CEO and Agent intake reject the removed proposal task type", async () => {
  const [intake, agentOpenApi, genericContract] = await Promise.all([
    read("src/features/intake/model/task-intake.ts"),
    read("public/founderops-agent-openapi.json"),
    read("src/features/intake/model/team-task-intake-contract.ts"),
  ]);

  assert.doesNotMatch(intake, /"proposal"/);
  assert.doesNotMatch(genericContract, /"proposal"/);
  assert.deepEqual(JSON.parse(agentOpenApi).components.schemas.TaskIntakeInput.properties.taskType.enum, ["deliverable", "sub_issue"]);
});
