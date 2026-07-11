import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const taskStatuses = ["Vorschlag", "Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt"];
const intake = await loadTranspiledModule(
  "src/features/intake/model/team-task-intake.ts",
  {
    "@/lib/api-input": {
      cleanText: (value, maxLength) => typeof value === "string" ? value.trim().slice(0, maxLength) : "",
    },
    "@/lib/platform": {
      isOperationalLeadRole: (role) => role === "ceo" || role === "deputy",
    },
    "@/lib/slug": {
      normalizeLookup: (value) => value.trim().toLowerCase(),
      slugify: (value) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""),
    },
    "@/lib/status": { taskStatuses },
    "@/features/intake/model/task-intake": {
      parseTaskIntakePayload: (payload) => Array.isArray(payload) ? payload : payload?.tasks || [],
    },
  },
);

let currentTokenRow = null;
let currentTokenQueryError = null;
let currentUsageError = null;
const mockTokenSupabase = {
  from() {
    return {
      select() {
        return {
          eq() {
            return {
              maybeSingle: async () => ({ data: currentTokenRow, error: currentTokenQueryError }),
            };
          },
        };
      },
      update() {
        return {
          eq() {
            return {
              eq: async () => ({ error: currentUsageError }),
            };
          },
        };
      },
    };
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
    { id: "founder-1", name: "Founder One", github_login: "founder-one" },
    { id: "founder-2", name: "Founder Two", github_login: "founder-two" },
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

test("team intake batch and task-type policy fails closed", () => {
  assert.equal(intake.validateTeamTaskIntakeBatchSize(0), "Keine Aufgaben im Payload gefunden.");
  assert.equal(intake.validateTeamTaskIntakeBatchSize(30), "");
  assert.equal(intake.validateTeamTaskIntakeBatchSize(31), "Maximal 30 Aufgaben pro Intake.");
  assert.equal(intake.isAllowedTeamTaskIntakeTaskType("proposal"), true);
  assert.equal(intake.isAllowedTeamTaskIntakeTaskType("sub_issue"), true);
  assert.equal(intake.isAllowedTeamTaskIntakeTaskType("deliverable"), false);
});

test("personal token auth rejects missing, expired, revoked, viewer, and missing-scope tokens", async () => {
  const token = "fmd_ti_valid-personal-token";
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const baseRow = {
    id: "550e8400-e29b-41d4-a716-446655440000",
    profile_id: "founder-1",
    label: "Test",
    token_hash: tokenHash,
    token_hint: "…token",
    scopes: ["read:task-context", "write:task-intake"],
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    created_at: new Date().toISOString(),
    last_used_at: null,
    revoked_at: null,
    profiles: { id: "founder-1", name: "Founder One", platform_role: "founder", github_login: "founder-one" },
  };
  const request = (value = token) => ({ headers: new Headers(value ? { authorization: `Bearer ${value}` } : {}) });

  currentTokenQueryError = null;
  currentUsageError = null;
  currentTokenRow = baseRow;
  assert.equal((await tokenAuth.requireTeamTaskIntakeScope(request(), "read:task-context")).ok, true);
  assert.equal((await tokenAuth.requireTeamTaskIntakeScope(request(""), "read:task-context")).status, 401);

  currentTokenRow = { ...baseRow, expires_at: new Date(Date.now() - 1_000).toISOString() };
  assert.equal((await tokenAuth.requireTeamTaskIntakeScope(request(), "read:task-context")).status, 401);

  currentTokenRow = { ...baseRow, revoked_at: new Date().toISOString() };
  assert.equal((await tokenAuth.requireTeamTaskIntakeScope(request(), "read:task-context")).status, 401);

  currentTokenRow = { ...baseRow, profiles: { ...baseRow.profiles, platform_role: "viewer" } };
  assert.equal((await tokenAuth.requireTeamTaskIntakeScope(request(), "read:task-context")).status, 403);

  currentTokenRow = { ...baseRow, scopes: ["read:task-context"] };
  assert.equal((await tokenAuth.requireTeamTaskIntakeScope(request(), "write:task-intake")).status, 403);

  currentTokenRow = baseRow;
  currentUsageError = { message: "write failed" };
  assert.equal((await tokenAuth.requireTeamTaskIntakeScope(request(), "read:task-context")).status, 500);
});

test("founders may refine only their own deliverables while operational leads may refine any", () => {
  assert.equal(intake.canCreateTeamSubIssueUnderDeliverable({ actorId: "founder-1", actorRole: "founder", parentOwnerId: "founder-1" }), true);
  assert.equal(intake.canCreateTeamSubIssueUnderDeliverable({ actorId: "founder-1", actorRole: "founder", parentOwnerId: "founder-2" }), false);
  assert.equal(intake.canCreateTeamSubIssueUnderDeliverable({ actorId: "founder-1", actorRole: "ceo", parentOwnerId: "founder-2" }), true);
  assert.equal(intake.canCreateTeamSubIssueUnderDeliverable({ actorId: "founder-1", actorRole: "deputy", parentOwnerId: "founder-2" }), true);
});

test("proposal preview stays sprintless and non-score-relevant", () => {
  const [preview] = intake.buildTeamTaskIntakePreview([{
    taskType: "proposal",
    title: "Clarify onboarding risks",
    packageId: "initiative-1",
    sprintId: "sprint-1",
    status: "Erledigt",
  }], context, actor);

  assert.equal(preview.taskType, "proposal");
  assert.equal(preview.status, "Vorschlag");
  assert.equal(preview.scoreRelevant, false);
  assert.equal(preview.ownerId, "");
  assert.match(preview.errors.join(" "), /keine Sprint-Zuordnung/);
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

test("team intake routes, profile UI and database boundary remain explicitly guarded", async () => {
  const [
    migration,
    tokenAuth,
    tokenRoute,
    tokenDeleteRoute,
    contextRoute,
    previewRoute,
    commitRoute,
    contextProjection,
    profileSettings,
    profileTokenUi,
    openapi,
  ] = await Promise.all([
    readFile("supabase/0054_team_task_intake_api.sql", "utf8"),
    readFile("src/features/intake/model/team-task-intake-token.ts", "utf8"),
    readFile("src/app/api/team/task-intake-tokens/route.ts", "utf8"),
    readFile("src/app/api/team/task-intake-tokens/[id]/route.ts", "utf8"),
    readFile("src/app/api/team/task-context/route.ts", "utf8"),
    readFile("src/app/api/team/task-intake/preview/route.ts", "utf8"),
    readFile("src/app/api/team/task-intake/commit/route.ts", "utf8"),
    readFile("src/features/intake/model/team-task-context.ts", "utf8"),
    readFile("src/features/profile/organisms/profile-settings-overview.tsx", "utf8"),
    readFile("src/features/profile/organisms/profile-team-intake-tokens.tsx", "utf8"),
    readFile("public/founderops-team-intake-openapi.json", "utf8"),
  ]);

  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on table public\.team_task_intake_tokens from public, anon, authenticated/);
  assert.match(migration, /grant select, insert, update on table public\.team_task_intake_tokens to service_role/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /create_team_task_intake_batch_transaction/);
  assert.match(migration, /create_task_transaction/);
  assert.match(migration, /team\.task_intake\.commit/);
  assert.match(tokenAuth, /createHash\("sha256"\)/);
  assert.match(tokenAuth, /timingSafeEqual/);
  assert.match(tokenAuth, /expires_at/);
  assert.match(tokenAuth, /last_used_at/);
  assert.doesNotMatch(tokenAuth, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(tokenRoute, /requireFounder/);
  assert.match(tokenDeleteRoute, /requireFounder/);
  assert.match(contextRoute, /read:task-context/);
  assert.match(previewRoute, /write:task-intake/);
  assert.match(commitRoute, /idempotency-key/);
  assert.match(commitRoute, /create_team_task_intake_batch_transaction|commitTeamTaskIntake/);
  assert.doesNotMatch(contextProjection, /score_points|score_final|task_reviews|audit_log|notification_events|provider_token/);
  assert.match(profileSettings, /ProfileTeamIntakeTokens/);
  assert.match(profileTokenUi, /Persönlicher API-Zugang/);
  assert.match(profileTokenUi, /90 Tagen/);
  assert.match(openapi, /"\/api\/team\/task-context"/);
  assert.match(openapi, /"\/api\/team\/task-intake\/preview"/);
  assert.match(openapi, /"\/api\/team\/task-intake\/commit"/);
  assert.doesNotMatch(openapi, /SUPABASE_SERVICE_ROLE_KEY|token_hash|provider_token/);
});
