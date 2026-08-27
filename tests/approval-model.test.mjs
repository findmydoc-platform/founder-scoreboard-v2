import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";









test("non-approved deliverables are gated from sprint review score and github", async () => {
  const taskRoute = await readFile("src/features/planning-items/model/planning-items-browser-task-update.ts", "utf8");
  const reviewRoute = await readFile("src/app/api/tasks/[id]/review/route.ts", "utf8");
  const reviewCommands = await readFile("src/features/planning-items/model/planning-items-review.ts", "utf8");
  const githubProjection = await readFile("src/lib/github-sync/task-projection.ts", "utf8");
  const sprintLock = await readFile("src/app/api/sprints/[id]/lock/route.ts", "utf8");
  const board = await readFile("src/features/planning/organisms/planning-task-view-renderer.tsx", "utf8");

  assert.match(taskRoute, /createPlanningReviewPlanningItems/);
  assert.match(reviewRoute, /createPlanningReviewPlanningItems/);
  assert.match(reviewCommands, /task\.approvalStatus !== "approved"/);
  assert.match(githubProjection, /loaded\.task\.approvalStatus !== "approved"/);
  assert.match(sprintLock, /task\.approval_status === "approved"/);
  assert.match(board, /isTaskPlanningActive/);
});

test("approval domain keeps client affordances and optimistic state aligned", async () => {
  const approval = await loadTranspiledModule("src/features/planning/model/approval-domain.ts");
  const initiative = { approvalStatus: "proposed", approvalRevision: 2 };
  const deliverable = {
    taskType: "deliverable",
    approvalStatus: "proposed",
    approvalRevision: 2,
    sprintId: "sprint-1",
    scoreRelevant: true,
  };

  assert.equal(approval.approvalStatusForAction("approve"), "approved");
  assert.equal(approval.approvalStatusForAction("return_to_draft"), "draft");
  assert.deepEqual(approval.applyOptimisticApprovalDecision(initiative, "reject", "Nicht jetzt"), {
    approvalStatus: "rejected",
    approvalRevision: 3,
    decisionNote: "Nicht jetzt",
  });
  assert.deepEqual(approval.applyOptimisticDeliverableApprovalDecision(deliverable, "reject"), {
    ...deliverable,
    approvalStatus: "rejected",
    approvalRevision: 3,
    decisionNote: "",
    sprintId: "",
    scoreRelevant: false,
  });
  const planningData = {
    tasks: [
      { ...deliverable, id: "deliverable-1" },
      { id: "child-1", taskType: "sub_issue", parentTaskId: "deliverable-1", parentApprovalStatus: "proposed" },
      { id: "child-2", taskType: "sub_issue", parentTaskId: "deliverable-2", parentApprovalStatus: "approved" },
    ],
  };
  const approved = approval.applyDeliverableApprovalPatch(planningData, {
    id: "deliverable-1",
    approvalStatus: "approved",
  });
  assert.equal(approved.tasks[0].approvalStatus, "approved");
  assert.equal(approved.tasks[1].parentApprovalStatus, "approved");
  assert.equal(approved.tasks[2].parentApprovalStatus, "approved");
  const reset = approval.applyDeliverableApprovalPatch(approved, {
    id: "deliverable-1",
    approvalStatus: "proposed",
  });
  assert.equal(reset.tasks[1].parentApprovalStatus, "proposed");
  assert.equal(reset.tasks[2].parentApprovalStatus, "approved");
  assert.equal(approval.isTaskPlanningActive({ taskType: "sub_issue", approvalStatus: null, parentApprovalStatus: "approved" }), true);
  assert.equal(approval.canApproveDeliverableApproval(deliverable, { accountableProfileId: "owner-1", approvalStatus: "approved" }, { id: "owner-1", platformRole: "founder" }), true);
  assert.equal(approval.canRejectDeliverableApproval(deliverable, { accountableProfileId: "owner-1", approvalStatus: "proposed" }, { id: "owner-1", platformRole: "founder" }), true);
  assert.equal(approval.canApproveDeliverableApproval(deliverable, { accountableProfileId: "owner-1", approvalStatus: "approved" }, { id: "deputy-1", platformRole: "deputy" }), true);
  assert.equal(approval.canRejectDeliverableApproval(deliverable, { accountableProfileId: "owner-1", approvalStatus: "proposed" }, { id: "deputy-1", platformRole: "deputy" }), true);
  assert.equal(approval.canDecideInitiativeApproval(initiative, { platformRole: "deputy" }), true);
  assert.equal(approval.canDecideInitiativeApproval(initiative, { platformRole: "founder" }), false);
});

test("github issue references preserve repository matching before reuse", async () => {
  const references = await loadTranspiledModule("src/lib/github-issue-reference.ts");

  assert.deepEqual(references.parseGitHubIssueUrl("https://github.com/findmydoc-platform/management/issues/42"), {
    repository: "findmydoc-platform/management",
    number: 42,
  });
  assert.equal(references.resolveGitHubIssueNumber({ issue_url: "https://github.com/findmydoc-platform/website/issues/7" }, {
    repository: "findmydoc-platform/management",
  }), null);
  assert.equal(references.resolveGitHubIssueNumber({ github_issue_number: 12 }, {
    repository: "findmydoc-platform/management",
  }), 12);
});

test("deliverables always use management while sub issues may choose an allowed repository", async () => {
  const repositories = await loadTranspiledModule("src/lib/github-repositories.ts");

  assert.deepEqual(repositories.resolveTaskGitHubRepository("deliverable", "findmydoc-platform/management"), {
    ok: true,
    repository: "findmydoc-platform/management",
  });
  assert.deepEqual(repositories.resolveTaskGitHubRepository("sub_issue", "findmydoc-platform/website"), {
    ok: true,
    repository: "findmydoc-platform/website",
  });
  assert.deepEqual(repositories.resolveTaskGitHubRepository("deliverable", "findmydoc-platform/website"), {
    ok: false,
    error: "Deliverables werden ausschließlich nach findmydoc-platform/management projiziert.",
  });
});

test("planning items publish an approval-aware repository contract", async () => {
  const openapi = JSON.parse(await readFile("public/founderops-team-planning-items-v2-openapi.json", "utf8"));
  const teamCreateRoute = await readFile("src/features/planning-items/model/planning-items-team-create-route.ts", "utf8");
  const createModule = await readFile("src/features/planning-items/model/planning-items-create.ts", "utf8");
  const intakeDocs = await readFile("docs/team-planning-items-api.md", "utf8");

  assert.ok(openapi.paths["/api/team/planning-items/v2/items/preview"]);
  assert.ok(openapi.paths["/api/team/planning-items/v2/items"]);
  assert.equal(openapi.paths["/api/team/task-intake/v2/preview"], undefined);
  assert.equal(openapi.paths["/api/team/task-intake/v2/commit"], undefined);
  assert.match(teamCreateRoute, /createTeamCreatePlanningItems/);
  assert.match(teamCreateRoute, /mode: "preview"/);
  assert.match(createModule, /create_team_planning_items_with_projection_transaction/);
  assert.match(intakeDocs, /Canonical `itemType` values are `epic`, `initiative`, `deliverable`, and `sub_issue`/);
  assert.match(intakeDocs, /retired `milestone` item type/);
  assert.match(intakeDocs, /Sub-Issue.*approved Deliverable/);
});



test("carry-overs re-enter approval without a Sprint assignment", async () => {
  const sprintLock = await readFile("src/app/api/sprints/[id]/lock/route.ts", "utf8");

  assert.match(sprintLock, /sprintId: null/);
  assert.match(sprintLock, /scoreRelevant: false/);
  assert.match(sprintLock, /approvalStatus: "proposed"/);
  assert.doesNotMatch(sprintLock, /sprintId: nextSprint\.id/);
  assert.doesNotMatch(sprintLock, /approvalStatus: "approved"/);
});
