import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { readSupabaseSchemaContract } from "../scripts/lib/supabase-migrations.mjs";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const actor = { profileId: "ceo", platformRole: "ceo", credential: { kind: "session" } };
const checklist = {
  acceptanceCriteriaMet: true,
  evidenceProvided: true,
  communicationClear: true,
  blockerHandled: true,
};

async function loadModel() {
  const storeContract = await loadTranspiledModule("src/features/planning-items/model/planning-items-store.ts");
  const runner = await loadTranspiledModule("src/features/planning-items/model/planning-items-runner.ts");
  const supabaseStore = await loadTranspiledModule(
    "src/features/planning-items/model/planning-items-store-supabase.ts",
    { "server-only": {}, "./planning-items-store": storeContract },
  );
  const reviewState = await loadTranspiledModule("src/features/reviews/model/task-review-state.ts");
  const notificationCatalog = await loadTranspiledModule("src/lib/notification-catalog.ts");
  return loadTranspiledModule("src/features/planning-items/model/planning-items-review.ts", {
    "server-only": {},
    "@/features/reviews/model/task-review-state": reviewState,
    "@/lib/notification-catalog": notificationCatalog,
    "./planning-items-runner": runner,
    "./planning-items-store-supabase": supabaseStore,
  });
}

function task(overrides = {}) {
  return {
    id: "task-one",
    task_type: "deliverable",
    updated_at: "2026-08-12T13:00:00.000Z",
    title: "Review task",
    status: "In Arbeit",
    approval_status: "approved",
    approval_revision: 2,
    assignee: "owner-one",
    owner: "owner-one",
    review_status: "not_requested",
    review_owner_profile_id: "reviewer-one",
    review_requested_at: null,
    score_points: 0,
    score_final: false,
    sprint_id: "sprint-one",
    score_relevant: true,
    trashed_at: null,
    github_issue_sync_status: "synced",
    ...overrides,
  };
}

function fixture({
  taskRow = task(),
  actorName = "CEO",
  reviewer = { id: "reviewer-one", contributor: true },
  defaultReviewer = reviewer,
  sprintLocked = false,
  resultTask = task({
    updated_at: "2026-08-12T13:01:00.000Z",
    status: "Review",
    review_status: "requested",
    review_requested_at: "2026-08-12T13:01:00.000Z",
    github_issue_sync_status: "not_synced",
  }),
  review = null,
  commitError = null,
} = {}) {
  const calls = [];
  return {
    calls,
    client: {
      async rpc(name, params) {
        calls.push([name, params]);
        if (name === "prepare_planning_review_command") {
          return { data: { task: taskRow, actorName, reviewer, defaultReviewer, sprintLocked }, error: null };
        }
        return commitError
          ? { data: null, error: commitError }
          : {
            data: {
              task: resultTask,
              review,
              activities: [{ id: 11, task_id: taskRow.id, message: "Review geändert", created_at: "2026-08-12T13:01:00.000Z" }],
            },
            error: null,
          };
      },
    },
  };
}

test("review routes delegate to PlanningItems and the command RPC remains service-only", async () => {
  const paths = [
    "src/app/api/tasks/[id]/review/route.ts",
    "src/app/api/tasks/[id]/review/withdraw/route.ts",
    "src/app/api/tasks/[id]/review/reopen/route.ts",
  ];
  const routes = await Promise.all(paths.map((path) => readFile(path, "utf8")));
  const taskRoute = await readFile("src/app/api/tasks/[id]/route.ts", "utf8");
  const model = await readFile("src/features/planning-items/model/planning-items-review.ts", "utf8");
  const migration = await readFile("supabase/migrations/20260812133802_planning_review_command_transaction.sql", "utf8");
  const schema = await readSupabaseSchemaContract();
  const verifier = await readFile("scripts/verify-task-review-transaction.mjs", "utf8");

  for (const route of routes) {
    assert.match(route, /createPlanningReviewPlanningItems/);
    assert.match(route, /\.run\(/);
    assert.doesNotMatch(route, /review_task_transaction|transition_task_review_transaction|\.from\("tasks"\)|createNotificationPayload|requireTaskReviewer/);
  }
  assert.match(taskRoute, /isPlanningReviewRequestPayload/);
  assert.match(taskRoute, /requestPlanningReviewCommand/);
  assert.doesNotMatch(taskRoute, /const reviewPackageId|accountable_profile_id|update\.review_status = "requested"/);
  assert.match(model, /prepare_planning_review_command/);
  assert.match(model, /mutate_planning_review_command_transaction/);
  assert.match(migration, /public\.review_task_transaction/);
  assert.match(migration, /public\.transition_task_review_transaction/);
  assert.match(migration, /public\.update_task_transaction/);
  assert.match(migration, /task\.review\.request/);
  assert.match(migration, /grant execute on function public\.mutate_planning_review_command_transaction[\s\S]*to service_role/);
  assert.match(schema, /mutate_planning_review_command_transaction/);
  assert.match(verifier, /authenticated_commit/);
  assert.match(verifier, /rollbackState/);
});

test("review transport parsers preserve validation and canonical command shapes", async () => {
  const model = await loadModel();
  const revision = "2026-08-12T13:00:00.000Z";
  assert.equal(model.isPlanningReviewRequestPayload({ status: "Review" }), true);
  assert.deepEqual(model.parsePlanningReviewRequestPayload({ expectedUpdatedAt: revision, status: "Review", reviewStatus: "requested" }), {
    ok: true,
    value: { expectedUpdatedAt: revision, reviewerProfileId: "" },
  });
  assert.equal(model.parsePlanningReviewRequestPayload({ expectedUpdatedAt: revision, status: "Review", title: "combined" }).status, 409);
  assert.equal(model.parsePlanningReviewDecisionPayload({ decision: "partial", checklist: {}, comment: "" }).error, "Kleine Nacharbeit setzt ein bis drei erfüllte Prüfpunkte voraus.");
  assert.equal(model.parsePlanningReviewWithdrawPayload({ expectedUpdatedAt: revision, reason: "x" }).error, "Ein Grund für das Zurückziehen ist erforderlich.");
  assert.equal(model.parsePlanningReviewReopenPayload({}).error, "Aktueller Aufgabenstand ist erforderlich.");
  assert.deepEqual(model.requestPlanningReviewCommand("task-one", { expectedUpdatedAt: revision }), {
    kind: "actOnItem",
    action: { kind: "requestReview", itemId: "task-one", expectedRevision: revision },
  });
  assert.equal(model.decidePlanningReviewCommand("task-one", { decision: "accepted", comment: "", checklist }).action.kind, "decideReview");
  assert.equal(model.withdrawPlanningReviewCommand("task-one", revision, "Need work").action.reason, "Need work");
  assert.equal(model.reopenPlanningReviewCommand("task-one", revision).action.kind, "reopenReview");
});

test("request, decide, withdraw, and reopen share Preview policy and one atomic writer", async () => {
  const model = await loadModel();
  const revision = "2026-08-12T13:00:00.000Z";
  const cases = [
    {
      command: model.requestPlanningReviewCommand("task-one", { expectedUpdatedAt: revision }),
      current: fixture(),
      expectedEffects: ["activity", "notification", "audit", "githubProjection"],
    },
    {
      command: model.decidePlanningReviewCommand("task-one", { decision: "accepted", comment: "", checklist }),
      current: fixture({
        taskRow: task({ status: "Review", review_status: "requested" }),
        resultTask: task({ status: "Erledigt", review_status: "accepted", score_points: 10, score_final: true, updated_at: "2026-08-12T13:01:00.000Z" }),
        review: { id: 21, task_id: "task-one", sprint_id: "sprint-one", reviewer_profile_id: "ceo", decision: "accepted", points: 10, comment: "", checklist, created_at: "2026-08-12T13:01:00.000Z" },
      }),
      expectedEffects: ["activity", "notification", "audit", "githubProjection"],
    },
    {
      command: model.withdrawPlanningReviewCommand("task-one", revision, "Need more work"),
      current: fixture({ taskRow: task({ status: "Review", review_status: "requested" }), resultTask: task({ updated_at: "2026-08-12T13:01:00.000Z" }) }),
      expectedEffects: ["activity", "notification", "audit", "githubProjection"],
    },
    {
      command: model.reopenPlanningReviewCommand("task-one", revision),
      current: fixture({ taskRow: task({ status: "Erledigt", review_status: "accepted", score_points: 10, score_final: true }) }),
      expectedEffects: ["activity", "notification", "audit", "githubProjection"],
    },
  ];

  for (const currentCase of cases) {
    const planning = model.createPlanningReviewPlanningItems(currentCase.current.client);
    const preview = await planning.run({ actor, mode: "preview", command: currentCase.command });
    const committed = await planning.run({ actor, mode: "commit", command: currentCase.command, requestMetadata: { requestIp: "test-ip", userAgent: "test-agent" } });
    assert.equal(preview.status, "previewed");
    assert.equal(committed.status, "committed");
    assert.deepEqual(preview.effects.map((effect) => effect.kind), currentCase.expectedEffects);
    assert.deepEqual(committed.effects.map((effect) => effect.kind), currentCase.expectedEffects);
    assert.equal(currentCase.current.calls.filter(([name]) => name === "mutate_planning_review_command_transaction").length, 1);
    assert.equal(currentCase.current.calls.at(-1)[1].p_request_ip, "test-ip");
    assert.ok(model.planningReviewTaskFromResult(committed));
  }
});

test("review role, ownership, reviewer, lock, revision, and state boundaries fail before commit", async () => {
  const model = await loadModel();
  const revision = "2026-08-12T13:00:00.000Z";
  const owner = { ...actor, profileId: "owner-one", platformRole: "founder" };
  const reviewer = { ...actor, profileId: "reviewer-one", platformRole: "founder" };
  const unrelated = { ...actor, profileId: "other-one", platformRole: "founder" };
  const viewer = { ...actor, profileId: "viewer-one", platformRole: "viewer" };

  const allowedRequest = fixture({ actorName: "owner-one" });
  assert.equal((await model.createPlanningReviewPlanningItems(allowedRequest.client).run({ actor: owner, mode: "commit", command: model.requestPlanningReviewCommand("task-one", { expectedUpdatedAt: revision }) })).status, "committed");
  const deniedRequest = fixture();
  assert.equal((await model.createPlanningReviewPlanningItems(deniedRequest.client).run({ actor: unrelated, mode: "commit", command: model.requestPlanningReviewCommand("task-one", { expectedUpdatedAt: revision }) })).error.code, "forbidden");
  assert.equal(deniedRequest.calls.filter(([name]) => name === "mutate_planning_review_command_transaction").length, 0);

  const founderReviewerOverride = fixture({
    actorName: "owner-one",
    reviewer: { id: "other-one", contributor: true },
    defaultReviewer: { id: "reviewer-one", contributor: true },
  });
  const founderOverrideResult = await model.createPlanningReviewPlanningItems(founderReviewerOverride.client).run({
    actor: owner,
    mode: "commit",
    command: model.requestPlanningReviewCommand("task-one", { expectedUpdatedAt: revision, reviewerProfileId: "other-one" }),
  });
  assert.equal(founderOverrideResult.status, "committed");
  assert.equal(founderReviewerOverride.calls.at(-1)[1].p_reviewer_profile_id, "reviewer-one");

  const ceoReviewerOverride = fixture({
    reviewer: { id: "other-one", contributor: true },
    defaultReviewer: { id: "reviewer-one", contributor: true },
  });
  const ceoOverrideResult = await model.createPlanningReviewPlanningItems(ceoReviewerOverride.client).run({
    actor,
    mode: "commit",
    command: model.requestPlanningReviewCommand("task-one", { expectedUpdatedAt: revision, reviewerProfileId: "other-one" }),
  });
  assert.equal(ceoOverrideResult.status, "committed");
  assert.equal(ceoReviewerOverride.calls.at(-1)[1].p_reviewer_profile_id, "other-one");

  const active = task({ status: "Review", review_status: "requested" });
  const allowedDecision = fixture({ taskRow: active, resultTask: task({ status: "Erledigt", review_status: "accepted", score_final: true, score_points: 10 }), review: { id: 22, task_id: "task-one", decision: "accepted", points: 10, checklist } });
  assert.equal((await model.createPlanningReviewPlanningItems(allowedDecision.client).run({ actor: reviewer, mode: "commit", command: model.decidePlanningReviewCommand("task-one", { decision: "accepted", comment: "", checklist }) })).status, "committed");
  const deniedDecision = fixture({ taskRow: active });
  assert.equal((await model.createPlanningReviewPlanningItems(deniedDecision.client).run({ actor: owner, mode: "commit", command: model.decidePlanningReviewCommand("task-one", { decision: "accepted", comment: "", checklist }) })).error.code, "forbidden");

  const boundaries = [
    [fixture({ sprintLocked: true }), owner, model.requestPlanningReviewCommand("task-one", { expectedUpdatedAt: revision }), "conflict"],
    [fixture({ reviewer: { id: "viewer-one", contributor: false } }), owner, model.requestPlanningReviewCommand("task-one", { expectedUpdatedAt: revision }), "conflict"],
    [fixture(), owner, model.requestPlanningReviewCommand("task-one", { expectedUpdatedAt: "2026-08-12T12:00:00.000Z" }), "conflict"],
    [fixture({ taskRow: task({ approval_status: "proposed" }) }), actor, model.requestPlanningReviewCommand("task-one", { expectedUpdatedAt: revision }), "conflict"],
    [fixture(), viewer, model.requestPlanningReviewCommand("task-one", { expectedUpdatedAt: revision }), "forbidden"],
  ];
  for (const [current, currentActor, command, code] of boundaries) {
    const result = await model.createPlanningReviewPlanningItems(current.client).run({ actor: currentActor, mode: "commit", command });
    assert.equal(result.error.code, code);
    assert.equal(current.calls.filter(([name]) => name === "mutate_planning_review_command_transaction").length, 0);
  }
});
