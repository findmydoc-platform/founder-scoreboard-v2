import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const reviewState = await loadTranspiledModule(
  "src/features/reviews/model/task-review-state.ts",
);

const completeChecklist = {
  acceptanceCriteriaMet: true,
  evidenceProvided: true,
  communicationClear: true,
  blockerHandled: true,
};

test("review decisions keep the compatible values and visible labels", () => {
  assert.deepEqual(reviewState.reviewDecisionLabels, {
    accepted: "Akzeptiert",
    partial: "Kleine Nacharbeit",
    changes_requested: "Grundlegend überarbeiten",
  });
  assert.deepEqual(reviewState.reviewDecisionTaskState("accepted"), { status: "Erledigt", scoreFinal: true });
  assert.deepEqual(reviewState.reviewDecisionTaskState("partial"), { status: "Nacharbeit", scoreFinal: false });
  assert.deepEqual(reviewState.reviewDecisionTaskState("changes_requested"), { status: "Nacharbeit", scoreFinal: false });
  assert.equal(reviewState.isReviewReworkDecision("accepted"), false);
  assert.equal(reviewState.isReviewReworkDecision("partial"), true);
  assert.equal(reviewState.isReviewReworkDecision("changes_requested"), true);
  assert.equal(reviewState.isReviewStateFinal("accepted", true), true);
  assert.equal(reviewState.isReviewStateFinal("partial", true), false);
  assert.equal(reviewState.isReviewStateLocked("partial", true), false);
  assert.match(reviewState.reviewDecisionConsequence("partial", 8), /Nacharbeit.*weiterbearbeitbar.*offen/);
  assert.match(reviewState.reviewDecisionConsequence("changes_requested", 0), /grundlegend überarbeiten.*weiterbearbeitbar.*offen/);
});

test("review validation requires complete acceptance and explanatory comments", () => {
  assert.equal(reviewState.reviewDecisionValidation("accepted", completeChecklist, "").ok, true);
  assert.equal(reviewState.reviewDecisionValidation("accepted", { ...completeChecklist, acceptanceCriteriaMet: undefined, dodMet: true }, "").ok, true);
  assert.equal(reviewState.reviewDecisionValidation("accepted", { ...completeChecklist, blockerHandled: false }, "").ok, false);
  assert.equal(reviewState.reviewDecisionValidation("partial", completeChecklist, "Documented deviation").ok, false);
  assert.equal(reviewState.reviewDecisionValidation("partial", { acceptanceCriteriaMet: true }, "").ok, false);
  assert.equal(reviewState.reviewDecisionValidation("partial", { acceptanceCriteriaMet: true }, "Documented deviation").ok, true);
  assert.equal(reviewState.reviewDecisionValidation("changes_requested", {}, "").ok, false);
  assert.equal(reviewState.reviewDecisionValidation("changes_requested", {}, "Rework needed").ok, true);
});

test("review lock allows only optimistic concurrency and owner reassignment patches", () => {
  assert.equal(reviewState.hasReviewLockedTaskChanges({ expectedUpdatedAt: "2026-07-17T12:00:00Z" }), false);
  assert.equal(reviewState.hasReviewLockedTaskChanges({ reviewOwnerProfileId: "reviewer", expectedUpdatedAt: "2026-07-17T12:00:00Z" }, { allowReviewOwnerChange: true }), false);
  assert.equal(reviewState.hasReviewLockedTaskChanges({ reviewOwnerProfileId: "reviewer", expectedUpdatedAt: "2026-07-17T12:00:00Z" }), true);
  assert.equal(reviewState.hasReviewLockedTaskChanges({ title: "Changed" }), true);
  assert.equal(reviewState.hasReviewLockedTaskChanges({ status: "In Arbeit" }), true);
});

test("planning review filters and My Reviews use the issue review state", async () => {
  const { buildPlanningTaskTableViewModel } = await loadTranspiledModule(
    "src/features/planning/model/planning-task-table-view-model.ts",
    {
      "@/features/planning/model/planning-app-model": {
        isThisWeek: () => false,
        sortTasks: (tasks) => tasks,
        taskText: (task) => task.title,
      },
      "@/features/tasks/model/task-attention-signals": {
        taskHasCriticalAttention: () => false,
        taskHasMissingEvidenceAttention: () => false,
      },
      "@/lib/platform": {
        hasGitHubIssue: () => true,
        hasOpenWaitingRelation: () => false,
        taskBelongsToProfile: () => false,
      },
      "@/lib/status": { normalizeStatus: (status) => status },
    },
  );
  const tasks = [
    { id: "mine", taskType: "deliverable", title: "Mine", status: "Review", reviewStatus: "requested", scoreFinal: false, reviewOwnerProfileId: "reviewer", priority: "P1", assignee: "Ada", workstream: "Product" },
    { id: "locked", taskType: "deliverable", title: "Locked", status: "Review", reviewStatus: "requested", scoreFinal: true, reviewOwnerProfileId: "reviewer", priority: "P1", assignee: "Ada", workstream: "Product" },
    { id: "other", taskType: "deliverable", title: "Other", status: "Review", reviewStatus: "requested", scoreFinal: false, reviewOwnerProfileId: "other-reviewer", priority: "P1", assignee: "Bob", workstream: "Product" },
    { id: "partial", taskType: "deliverable", title: "Partial", status: "Nacharbeit", reviewStatus: "partial", scoreFinal: false, reviewOwnerProfileId: "reviewer", priority: "P1", assignee: "Ada", workstream: "Product" },
  ];
  const data = { tasks, packages: [], sprints: [], profiles: [], taskRelations: [] };
  const baseFilters = {
    query: "", assignee: "Alle", status: "Alle", priority: "Alle", review: "Alle", packageId: "Alle",
    quick: [], sprintId: "Alle", workstream: "Alle", risk: "Alle", targetFrom: "", targetTo: "", sort: "priority", direction: "asc",
  };

  const mine = buildPlanningTaskTableViewModel({
    currentProfile: { id: "reviewer" },
    data,
    filters: { ...baseFilters, quick: ["my-reviews"] },
  });
  const partial = buildPlanningTaskTableViewModel({
    currentProfile: { id: "reviewer" },
    data,
    filters: { ...baseFilters, review: "partial" },
  });

  assert.deepEqual(mine.visibleTasks.map((task) => task.id), ["mine"]);
  assert.deepEqual(partial.visibleTasks.map((task) => task.id), ["partial"]);
});

test("only accepted reviews contribute while both rework decisions stay open", async () => {
  const platform = await loadTranspiledModule("src/lib/platform.ts");
  const scoring = await loadTranspiledModule("src/lib/founderops-scoring.ts");
  const baseTask = {
    id: "task",
    taskType: "deliverable",
    scoreRelevant: true,
    assigneeId: "founder",
    assignee: "Founder",
    ownerId: "founder",
    owner: "Founder",
    status: "Nacharbeit",
    scorePoints: 8,
    scoreFinal: false,
    definitionOfDone: "Defined",
    evidenceLink: "https://example.com/evidence",
    githubIssueUrl: "",
    issueUrl: "",
    sprintOutcome: "",
  };
  const profile = { id: "founder", name: "Founder" };

  assert.equal(platform.calculateTaskScore({ ...baseTask, reviewStatus: "partial" }), 0);
  assert.equal(platform.calculateTaskScore({ ...baseTask, reviewStatus: "changes_requested" }), 0);
  assert.equal(platform.calculateTaskScore({ ...baseTask, status: "Erledigt", reviewStatus: "accepted", scoreFinal: true }), 8);
  assert.equal(platform.calculateTaskScore({ ...baseTask, status: "Erledigt", reviewStatus: "partial", scoreFinal: true }), 0);
  assert.equal(platform.calculateTaskScore({ ...baseTask, status: "Erledigt", reviewStatus: "accepted", scorePoints: 10, scoreFinal: true }), 10);

  const partialScore = scoring.computeFounderSprintScore({
    profile,
    tasks: [{ ...baseTask, status: "Nacharbeit", reviewStatus: "partial", scoreFinal: false }],
    meetings: [],
    meetingAttendance: [],
  });
  const acceptedScore = scoring.computeFounderSprintScore({
    profile,
    tasks: [{ ...baseTask, status: "Erledigt", reviewStatus: "accepted", scoreFinal: true }],
    meetings: [],
    meetingAttendance: [],
  });

  assert.equal(partialScore.deliveryPoints, 0);
  assert.equal(partialScore.formPoints, 3);
  assert.equal(acceptedScore.deliveryPoints, 12);
  assert.equal(acceptedScore.formPoints, 4);
});

test("review integration migration keeps both rework decisions open and installs atomic process functions", async () => {
  const migration = await readFile(
    "supabase/migrations/20260717175618_integrate_reviews_into_tasks.sql",
    "utf8",
  );

  assert.match(migration, /status = 'Erledigt'[\s\S]*score_final = true[\s\S]*where review_status = 'accepted'/);
  assert.match(migration, /status = 'Nacharbeit'[\s\S]*score_final = false[\s\S]*where review_status in \('partial', 'changes_requested'\)/);
  assert.match(migration, /create or replace function public\.transition_task_review_transaction/);
  assert.match(migration, /create or replace function public\.process_score_objection_transaction/);
  assert.match(migration, /revoke insert on table public\.task_reviews from authenticated/);
  assert.match(migration, /revoke insert, update on table public\.score_objections from authenticated/);
  assert.match(migration, /interval '48 hours'/);
});

test("sprint review window starts after the Berlin sprint end and supports the CEO-configured duration", async () => {
  const window = await loadTranspiledModule("src/lib/sprint-review-window.ts");
  assert.equal(window.sprintEndsAt("2026-07-19"), "2026-07-19T21:59:59.999Z");
  assert.equal(window.sprintEndsAt("2026-03-29"), "2026-03-29T21:59:59.999Z");
  assert.equal(window.sprintEndsAt("2026-10-25"), "2026-10-25T22:59:59.999Z");
  assert.equal(window.sprintReviewDueAt("2026-07-19"), "2026-07-21T21:59:59.999Z");
  assert.equal(window.sprintReviewDueAt("2026-03-29"), "2026-03-31T21:59:59.999Z");
  assert.equal(window.sprintReviewDueAt("2026-10-25"), "2026-10-27T22:59:59.999Z");
  assert.equal(window.sprintReviewDueAt("2026-07-19", 72), "2026-07-22T21:59:59.999Z");
  assert.equal(window.sprintReviewDueAt("2026-07-19", 0), "");
  assert.equal(window.sprintReviewDueAt("2026-07-19", 337), "");
  assert.equal(window.sprintObjectionWindowState("2026-07-19", "", new Date("2026-07-20T12:00:00.000Z")).open, true);
  assert.equal(window.sprintObjectionWindowState("2026-07-19", "", new Date("2026-07-22T12:00:00.000Z")).open, false);
});
