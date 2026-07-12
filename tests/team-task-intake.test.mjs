import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const taskStatuses = ["Vorschlag", "Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt"];
const contract = await loadTranspiledModule("src/features/intake/model/team-task-intake-contract.ts");
const normalization = await loadTranspiledModule(
  "src/features/intake/model/task-intake-normalization.ts",
  {
    "@/lib/api-input": {
      cleanText: (value, maxLength) => typeof value === "string" ? value.trim().slice(0, maxLength) : "",
    },
    "@/lib/slug": {
      normalizeLookup: (value) => value.trim().toLowerCase(),
      slugify: (value) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
    },
    "@/features/intake/model/team-task-intake-contract": contract,
  },
);
const policy = await loadTranspiledModule(
  "src/features/intake/model/team-task-intake-policy.ts",
  {
    "@/lib/platform": {
      isOperationalLeadRole: (role) => role === "ceo" || role === "deputy",
    },
    "@/features/intake/model/team-task-intake-contract": contract,
  },
);
const pagination = await loadTranspiledModule("src/features/intake/model/supabase-pagination.ts");
const intake = await loadTranspiledModule(
  "src/features/intake/model/team-task-intake.ts",
  {
    "@/lib/status": { taskStatuses },
    "@/features/intake/model/team-task-intake-contract": contract,
    "@/features/intake/model/task-intake-normalization": normalization,
    "@/features/intake/model/team-task-intake-policy": policy,
    "@/features/intake/model/supabase-pagination": pagination,
  },
);
const taskContext = await loadTranspiledModule(
  "src/features/intake/model/team-task-context.ts",
  {
    "@/lib/status": { normalizeStatus: (status) => status },
    "@/features/intake/model/team-task-intake-contract": contract,
    "@/features/intake/model/team-task-intake-policy": policy,
    "@/features/intake/model/supabase-pagination": pagination,
  },
);
const commit = await loadTranspiledModule(
  "src/features/intake/model/team-task-intake-commit.ts",
  {
    "@/lib/api-input": { auditRequestMetadata: () => ({ request_ip: null, user_agent: null }) },
    "@/features/intake/model/team-task-intake": intake,
  },
);

let currentAuthData = null;
let currentAuthError = null;
const mockTokenSupabase = {
  async rpc(name) {
    assert.equal(name, "authenticate_team_task_intake_token");
    return { data: currentAuthData, error: currentAuthError };
  },
};
const tokenAuth = await loadTranspiledModule(
  "src/features/intake/model/team-task-intake-token.ts",
  {
    "@/lib/supabase": { getServerSupabase: () => mockTokenSupabase },
  },
);

const actor = {
  id: "founder-1",
  name: "Founder One",
  platformRole: "founder",
  githubLogin: "founder-one",
};

const context = {
  profiles: [
    { id: "founder-1", name: "Founder One", githubLogin: "founder-one" },
    { id: "founder-2", name: "Founder Two", githubLogin: "founder-two" },
  ],
  initiatives: [{ id: "initiative-1", title: "Initiative One", milestone_id: "milestone-1" }],
  milestoneIds: new Set(["milestone-1"]),
  parentTasks: [
    {
      id: "deliverable-own",
      title: "Own Deliverable",
      task_type: "deliverable",
      owner: "founder-1",
      assignee: "founder-1",
      package_id: "initiative-1",
      milestone_id: "milestone-1",
    },
    {
      id: "deliverable-other",
      title: "Other Deliverable",
      task_type: "deliverable",
      owner: "founder-2",
      assignee: "founder-2",
      package_id: "initiative-1",
      milestone_id: "milestone-1",
    },
  ],
};

test("team intake contract centralizes limits, task types, scopes, and UUID validation", () => {
  assert.equal(contract.TEAM_TASK_INTAKE_MAX_TASKS, 30);
  assert.equal(contract.TEAM_TASK_INTAKE_MAX_ACTIVE_TOKENS, 3);
  assert.equal(contract.TEAM_TASK_INTAKE_TOKEN_TTL_DAYS, 90);
  assert.deepEqual(contract.TEAM_TASK_INTAKE_ALLOWED_TASK_TYPES, ["proposal", "sub_issue"]);
  assert.deepEqual(contract.TEAM_TASK_INTAKE_SCOPES, ["read:task-context", "write:task-intake"]);
  assert.equal(contract.TEAM_TASK_INTAKE_INPUT_RULES.hours.maximum, 200);
  assert.equal(contract.TEAM_TASK_INTAKE_INPUT_RULES.startDate.kind, "date");
  assert.equal(contract.isUuid("5e627de3-8e91-47ba-8c3f-e06ed8e26059"), true);
  assert.equal(contract.isUuid("not-a-uuid"), false);
});

test("team intake policy fails closed for batch size, task type, and foreign parents", () => {
  assert.equal(policy.validateTeamTaskIntakeBatchSize(0), "Keine Aufgaben im Payload gefunden.");
  assert.equal(policy.validateTeamTaskIntakeBatchSize(30), "");
  assert.equal(policy.validateTeamTaskIntakeBatchSize(31), "Maximal 30 Aufgaben pro Intake.");
  assert.equal(policy.isAllowedTeamTaskIntakeTaskType("proposal"), true);
  assert.equal(policy.isAllowedTeamTaskIntakeTaskType("sub_issue"), true);
  assert.equal(policy.isAllowedTeamTaskIntakeTaskType("deliverable"), false);
  assert.equal(policy.canCreateTeamSubIssueUnderDeliverable({ actorId: "founder-1", actorRole: "founder", parentOwnerId: "founder-1" }), true);
  assert.equal(policy.canCreateTeamSubIssueUnderDeliverable({ actorId: "founder-1", actorRole: "founder", parentOwnerId: "founder-2" }), false);
  assert.equal(policy.canCreateTeamSubIssueUnderDeliverable({ actorId: "founder-1", actorRole: "ceo", parentOwnerId: "founder-2" }), true);
});

test("team intake accepts only the documented object payload and rejects unknown fields", () => {
  assert.equal(intake.parseTeamTaskIntakePayload([{ title: "Array payload" }]).ok, false);
  assert.equal(intake.parseTeamTaskIntakePayload({ tasks: [{ title: "Known fields", taskType: "proposal" }] }).ok, true);
  assert.equal(intake.parseTeamTaskIntakePayload({ tasks: [{ title: "Known fields" }], metadata: {} }).ok, false);
  const unknown = intake.parseTeamTaskIntakePayload({ tasks: [{ title: "Unknown field", unexpected: true }] });
  assert.equal(unknown.ok, false);
  assert.match(unknown.error, /unbekannte Feld unexpected/);
  assert.match(intake.parseTeamTaskIntakePayload({ tasks: [{ title: "Valid title", startDate: "2026-99-99" }] }).error, /gültiges Datum/);
  assert.match(intake.parseTeamTaskIntakePayload({ tasks: [{ title: "Valid title", startDate: "" }] }).error, /gültiges Datum/);
  assert.match(intake.parseTeamTaskIntakePayload({ tasks: [{ title: "Valid title", hours: "invalid" }] }).error, /Zahl zwischen 0 und 200/);
  assert.equal(intake.parseTeamTaskIntakePayload({ tasks: [{ title: "Valid title", hours: 12.5, deadline: "2026-07-12" }] }).ok, true);
  assert.equal(normalization.intakeHours("invalid"), 0);
  assert.equal(normalization.intakeDate("2026-02-29"), "");
  assert.equal(normalization.intakeDate("2028-02-29"), "2028-02-29");
});

test("team context pagination loads every page and fails closed on page errors", async () => {
  const source = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];
  const loaded = await pagination.loadAllSupabaseRows(
    async (from, to) => ({ data: source.slice(from, to + 1), error: null }),
    2,
  );
  assert.deepEqual(loaded, source);
  await assert.rejects(
    pagination.loadAllSupabaseRows(async () => ({ data: null, error: { message: "page failed" } }), 2),
    /page failed/,
  );
});

test("team context relation statistics describe both sides of directed relationships", () => {
  const stats = taskContext.relationStatsByTask([
    { task_id: "a", related_task_id: "b", relation_type: "blocks" },
    { task_id: "c", related_task_id: "d", relation_type: "blocked_by" },
    { task_id: "a", related_task_id: "c", relation_type: "relates_to" },
  ]);
  assert.deepEqual(stats.get("a"), { count: 2, blocks: 1, blockedBy: 0 });
  assert.deepEqual(stats.get("b"), { count: 1, blocks: 0, blockedBy: 1 });
  assert.deepEqual(stats.get("c"), { count: 2, blocks: 0, blockedBy: 1 });
  assert.deepEqual(stats.get("d"), { count: 1, blocks: 1, blockedBy: 0 });
});

test("idempotency hash uses only normalized request data", () => {
  const first = commit.teamTaskIntakeRequestHash([{ title: "  Stable proposal  ", taskType: "proposal", owner: "Founder Two" }]);
  const second = commit.teamTaskIntakeRequestHash([{ title: "Stable proposal", taskType: "proposal", owner: "Founder Two" }]);
  const changed = commit.teamTaskIntakeRequestHash([{ title: "Changed proposal", taskType: "proposal", owner: "Founder Two" }]);
  assert.equal(first, second);
  assert.notEqual(first, changed);
});

test("personal token auth delegates atomic role, scope, expiry, and usage checks to the RPC", async () => {
  const request = (value = "fmd_ti_valid-personal-token") => ({ headers: new Headers(value ? { authorization: `Bearer ${value}` } : {}) });
  currentAuthError = null;
  currentAuthData = {
    tokenId: "550e8400-e29b-41d4-a716-446655440000",
    scopes: ["read:task-context", "write:task-intake"],
    profile: actor,
  };
  assert.equal((await tokenAuth.requireTeamTaskIntakeScope(request(), "read:task-context")).ok, true);
  assert.equal((await tokenAuth.requireTeamTaskIntakeScope(request(""), "read:task-context")).status, 401);

  for (const [code, status] of [["P0004", 401], ["P0005", 403], ["P0006", 403]]) {
    currentAuthData = null;
    currentAuthError = { code, message: "internal database detail" };
    const result = await tokenAuth.requireTeamTaskIntakeScope(request(), "write:task-intake");
    assert.equal(result.status, status);
    assert.doesNotMatch(result.error, /internal database detail/);
  }

  currentAuthError = { code: "XX000", message: "sensitive schema detail" };
  const failed = await tokenAuth.requireTeamTaskIntakeScope(request(), "read:task-context");
  assert.equal(failed.status, 500);
  assert.doesNotMatch(failed.error, /sensitive schema detail/);
});

test("proposal preview stays non-scoring and may name another team profile", () => {
  const [preview] = intake.buildTeamTaskIntakePreview([{
    taskType: "proposal",
    title: "Clarify onboarding risks",
    packageId: "initiative-1",
    owner: "founder-2",
    status: "Erledigt",
  }], context, actor);

  assert.deepEqual(preview.errors, []);
  assert.equal(preview.taskType, "proposal");
  assert.equal(preview.status, "Vorschlag");
  assert.equal(preview.scoreRelevant, false);
  assert.equal(preview.ownerId, "founder-2");
});

test("sub-issue preview inherits hierarchy and defaults ownership to the actor", () => {
  const [preview] = intake.buildTeamTaskIntakePreview([{
    taskType: "sub_issue",
    title: "Document one edge case",
    parentTaskId: "deliverable-own",
  }], context, actor);

  assert.deepEqual(preview.errors, []);
  assert.equal(preview.parentTaskTitle, "Own Deliverable");
  assert.equal(preview.packageId, "initiative-1");
  assert.equal(preview.milestoneId, "milestone-1");
  assert.equal(preview.ownerId, "founder-1");
  assert.equal(preview.status, "Offen");
  assert.equal(preview.scoreRelevant, false);
});

test("founder sub-issue preview rejects another founder's deliverable", () => {
  const [preview] = intake.buildTeamTaskIntakePreview([{
    taskType: "sub_issue",
    title: "Change another deliverable",
    parentTaskId: "deliverable-other",
  }], context, actor);

  assert.match(preview.errors.join(" "), /nur eigene Deliverables/);
});

test("team intake routes, profile UI, OpenAPI, and database boundary share one guarded contract", async () => {
  const [
    hardeningMigration,
    cleanupMigration,
    baselineSchema,
    tokenAuthSource,
    tokenRoutes,
    contextRoute,
    previewRoute,
    commitRoute,
    routeHandler,
    contextProjection,
    profileSettings,
    profileTokenUi,
    profileTokenHook,
    openapiSource,
  ] = await Promise.all([
    readFile("supabase/0055_team_task_intake_hardening.sql", "utf8"),
    readFile("supabase/0056_team_task_intake_review_fixes.sql", "utf8"),
    readFile("supabase/schema.sql", "utf8"),
    readFile("src/features/intake/model/team-task-intake-token.ts", "utf8"),
    Promise.all([
      readFile("src/app/api/team/task-intake-tokens/route.ts", "utf8"),
      readFile("src/app/api/team/task-intake-tokens/[id]/route.ts", "utf8"),
    ]).then((sources) => sources.join("\n")),
    readFile("src/app/api/team/task-context/route.ts", "utf8"),
    readFile("src/app/api/team/task-intake/preview/route.ts", "utf8"),
    readFile("src/app/api/team/task-intake/commit/route.ts", "utf8"),
    readFile("src/features/intake/model/team-task-intake-route.ts", "utf8"),
    readFile("src/features/intake/model/team-task-context.ts", "utf8"),
    readFile("src/features/profile/organisms/profile-settings-overview.tsx", "utf8"),
    readFile("src/features/profile/organisms/profile-team-intake-tokens.tsx", "utf8"),
    readFile("src/features/profile/hooks/use-profile-team-intake-tokens.ts", "utf8"),
    readFile("public/founderops-team-intake-openapi.json", "utf8"),
  ]);

  assert.match(hardeningMigration, /authenticate_team_task_intake_token/);
  assert.match(hardeningMigration, /for update/);
  assert.match(hardeningMigration, /for share/);
  assert.match(hardeningMigration, /response_tasks/);
  assert.match(hardeningMigration, /interval '90 days'/);
  assert.doesNotMatch(hardeningMigration, /v_item->'taskInsert'/);
  assert.match(cleanupMigration, /p_token_id::text/);
  assert.match(cleanupMigration, /drop function if exists public\.create_team_task_intake_token\(text, text, text, text, timestamptz\)/);
  assert.doesNotMatch(baselineSchema, /create or replace function public\.create_team_task_intake_token\(\s*p_profile_id text,\s*p_label text,\s*p_token_hash text,\s*p_token_hint text,\s*p_expires_at timestamptz/);
  assert.match(tokenAuthSource, /authenticate_team_task_intake_token/);
  assert.doesNotMatch(tokenAuthSource, /\.from\("team_task_intake_tokens"\)/);
  assert.match(tokenRoutes, /TEAM_TASK_INTAKE_TOKEN_HISTORY_LIMIT/);
  assert.match(tokenRoutes, /revoke_team_task_intake_token/);
  assert.doesNotMatch(tokenRoutes, /error\.message/);
  assert.match(contextRoute, /handleTeamTaskIntakeRequest/);
  assert.match(previewRoute, /buildTeamTaskIntakeForRoute/);
  assert.match(commitRoute, /loadTeamTaskIntakeReplay/);
  assert.match(routeHandler, /Cache-Control/);
  assert.doesNotMatch(`${contextRoute}\n${previewRoute}\n${commitRoute}`, /error\.message/);
  assert.doesNotMatch(contextProjection, /score_points|score_final|task_reviews|audit_log|notification_events|provider_token/);
  assert.match(profileSettings, /ProfileTeamIntakeTokens/);
  assert.match(profileTokenUi, /vollständigen task-zentrierten Team-Kontext/);
  assert.match(profileTokenHook, /TEAM_TASK_INTAKE_MAX_ACTIVE_TOKENS/);

  const openapi = JSON.parse(openapiSource);
  assert.equal(openapi.components.schemas.TeamTaskIntakePayload.additionalProperties, false);
  assert.ok(openapi.components.schemas.TeamTaskContextResponse);
  assert.ok(openapi.components.schemas.TeamTaskIntakePreviewResponse);
  assert.ok(openapi.components.schemas.TeamTaskIntakeValidationErrorResponse);
  assert.ok(openapi.components.schemas.TeamTaskIntakeCommitResponse);
  const inputSchema = openapi.components.schemas.TeamTaskIntakeInput;
  for (const [key, rule] of Object.entries(contract.TEAM_TASK_INTAKE_INPUT_RULES)) {
    const property = inputSchema.properties[key];
    assert.ok(property, `OpenAPI input field is missing: ${key}`);
    if (rule.kind === "string") {
      if (rule.minLength !== undefined) assert.equal(property.minLength, rule.minLength);
      assert.equal(property.maxLength, rule.maxLength);
    } else if (rule.kind === "enum") {
      assert.deepEqual(property.enum, [...rule.values]);
    } else if (rule.kind === "date") {
      assert.equal(property.format, "date");
    } else if (rule.kind === "number") {
      assert.equal(property.minimum, rule.minimum);
      assert.equal(property.maximum, rule.maximum);
    }
  }
  for (const [path, method] of [["/api/team/task-context", "get"], ["/api/team/task-intake/preview", "post"], ["/api/team/task-intake/commit", "post"]]) {
    const responses = openapi.paths[path][method].responses;
    const expectedStatuses = path === "/api/team/task-context"
      ? ["200", "401", "403", "500", "501", "503"]
      : path === "/api/team/task-intake/preview"
        ? ["200", "400", "401", "403", "500", "501", "503"]
        : ["200", "400", "401", "403", "409", "500", "501", "503"];
    assert.deepEqual(Object.keys(responses).sort(), expectedStatuses.sort());
    assert.match(responses["200"].content["application/json"].schema.$ref, /^#\/components\/schemas\//);
    for (const [status, response] of Object.entries(responses).filter(([status]) => status !== "200")) {
      const schema = response.content["application/json"].schema;
      if (path === "/api/team/task-intake/commit" && status === "400") {
        assert.deepEqual(schema.oneOf.map((item) => item.$ref), [
          "#/components/schemas/ErrorResponse",
          "#/components/schemas/TeamTaskIntakeValidationErrorResponse",
        ]);
      } else {
        assert.equal(schema.$ref, "#/components/schemas/ErrorResponse");
      }
    }
  }
});
