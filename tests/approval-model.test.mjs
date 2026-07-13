import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

test("approval model separates active task type from approval state", async () => {
  const types = await readFile("src/lib/types.ts", "utf8");
  const migration = await readFile("supabase/0059_planning_item_approval.sql", "utf8");

  assert.match(types, /TaskType = "deliverable" \| "sub_issue"/);
  assert.doesNotMatch(types, /TaskType = [^\n]*proposal/);
  assert.match(types, /ApprovalStatus = "draft" \| "proposed" \| "approved" \| "rejected"/);
  assert.match(migration, /task_type = 'sub_issue' and approval_status is null/);
  assert.match(migration, /task_type = 'deliverable' and approval_status = 'approved'[\s\S]*sprint_id is not null/);
  assert.match(migration, /legacy_proposal_unresolved/);
});

test("proposal is not an operational task status", async () => {
  const [types, migration, schema, resolution, catalog] = await Promise.all([
    readFile("src/lib/types.ts", "utf8"),
    readFile("supabase/0060_remove_proposal_work_status.sql", "utf8"),
    readFile("supabase/schema.sql", "utf8"),
    readFile("src/lib/notification-resolution.ts", "utf8"),
    readFile("src/lib/notification-catalog.ts", "utf8"),
  ]);
  const status = await loadTranspiledModule("src/lib/status.ts");

  assert.match(types, /TaskStatus = "Offen" \| "In Arbeit" \| "Review" \| "Nacharbeit" \| "Blockiert" \| "Erledigt"/);
  assert.deepEqual(status.taskStatuses, ["Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt"]);
  assert.equal(status.normalizeStatus("Vorschlag"), "Offen");
  assert.equal(status.normalizeStatus("draft"), "Offen");
  assert.equal(status.normalizeStatus("Idee"), "Offen");
  assert.match(migration, /update public\.tasks[\s\S]*set status = 'Offen'[\s\S]*where status = 'Vorschlag'/);
  assert.match(migration, /tasks_status_not_proposal_check[\s\S]*status <> 'Vorschlag'/);
  assert.match(schema, /constraint tasks_status_not_proposal_check check \(status <> 'Vorschlag'\)/);
  assert.doesNotMatch(resolution, /normalizeStatus\(task\.status\)[^\n]*Vorschlag/);
  assert.match(catalog, /"task\.proposed"[^\n]*label: "Vorschlag"/);
});

test("legacy Team Task Intake cleanup removes proposal storage and RPCs through the approved deploy path", async () => {
  const [cleanup, schema, deploy] = await Promise.all([
    readFile("supabase/migrations/20260712213443_remove_legacy_team_task_intake_v12.sql", "utf8"),
    readFile("supabase/schema.sql", "utf8"),
    readFile("scripts/deploy-production-schema.mjs", "utf8"),
  ]);

  assert.match(cleanup, /check \(task_type in \('deliverable', 'sub_issue'\)\)/);
  assert.match(cleanup, /drop column if exists legacy_proposal_unresolved/);
  assert.match(cleanup, /drop function if exists public\.create_team_task_intake_batch_transaction/);
  assert.doesNotMatch(schema, /drop column if exists legacy_proposal_unresolved/);
  assert.match(deploy, /20260712213443_remove_legacy_team_task_intake_v12\.sql/);
  assert.match(deploy, /approvedDestructiveMigrations/);
});

test("approval transactions enforce revision, initiative prerequisite, and current accountable", async () => {
  const migration = await readFile("supabase/0059_planning_item_approval.sql", "utf8");
  const initiativeRoute = await readFile("src/app/api/initiatives/[id]/approval/route.ts", "utf8");
  const taskRoute = await readFile("src/app/api/tasks/[id]/approval/route.ts", "utf8");

  assert.match(migration, /approval_revision <> p_expected_revision/);
  assert.match(migration, /v_actor_role <> 'ceo'/);
  assert.match(migration, /v_initiative\.accountable_profile_id/);
  assert.match(migration, /initiative must be approved first/);
  assert.match(migration, /task\.approval_reset/);
  assert.match(migration, /task\.approval_resubmitted/);
  assert.match(initiativeRoute, /decide_initiative_approval_transaction/);
  assert.match(taskRoute, /decide_deliverable_approval_transaction/);
});

test("non-approved deliverables are gated from sprint review score and github", async () => {
  const taskRoute = await readFile("src/app/api/tasks/[id]/route.ts", "utf8");
  const reviewRoute = await readFile("src/app/api/tasks/[id]/review/route.ts", "utf8");
  const githubRoute = await readFile("src/app/api/tasks/[id]/sync-github/route.ts", "utf8");
  const sprintLock = await readFile("src/app/api/sprints/[id]/lock/route.ts", "utf8");
  const board = await readFile("src/features/planning/organisms/planning-task-view-renderer.tsx", "utf8");

  assert.match(taskRoute, /approval_status !== "approved"/);
  assert.match(reviewRoute, /approval_status !== "approved"/);
  assert.match(githubRoute, /task\.approvalStatus !== "approved"/);
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
  assert.equal(approval.canDecideInitiativeApproval(initiative, { platformRole: "deputy" }), false);
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

test("team intake v2 publishes an approval-aware repository contract", async () => {
  const openapi = JSON.parse(await readFile("public/founderops-team-intake-openapi.json", "utf8"));
  const previewRoute = await readFile("src/app/api/team/task-intake/v2/preview/route.ts", "utf8");
  const commitRoute = await readFile("src/app/api/team/task-intake/v2/commit/route.ts", "utf8");
  const intakeDocs = await readFile("docs/team-task-intake-api.md", "utf8");

  assert.ok(openapi.paths["/api/team/task-intake/v2/preview"]);
  assert.ok(openapi.paths["/api/team/task-intake/v2/commit"]);
  assert.equal(openapi.paths["/api/team/task-intake/preview"], undefined);
  assert.equal(openapi.paths["/api/team/task-intake/commit"], undefined);
  assert.match(previewRoute, /buildTeamTaskIntakeV2Preview/);
  assert.match(commitRoute, /create_team_task_intake_v2_transaction/);
  assert.match(intakeDocs, /itemType = initiative \| deliverable \| sub_issue/);
  assert.match(intakeDocs, /Only Sub-Issues may select an allowed technical/);
});

test("github projection uses the item repository and native sub issue relationships", async () => {
  const repositories = await readFile("src/lib/github-repositories.ts", "utf8");
  const github = await readFile("src/lib/github.ts", "utf8");
  const route = await readFile("src/app/api/tasks/[id]/sync-github/route.ts", "utf8");
  const migration = await readFile("supabase/migrations/20260712213443_remove_legacy_team_task_intake_v12.sql", "utf8");

  assert.match(repositories, /findmydoc-platform\/management/);
  assert.match(repositories, /findmydoc-platform\/website/);
  assert.match(github, /splitGitHubRepository\(task\.githubRepo\)/);
  assert.match(github, /addSubIssue/);
  assert.match(github, /replaceParent: true/);
  assert.match(route, /connectGitHubSubIssue/);
  assert.match(route, /resolveTaskGitHubRepository/);
  assert.match(route, /github:\$\{repository\}#/);
  assert.match(migration, /task_type = 'sub_issue' and github_repo in/);
  assert.match(migration, /task_type = 'deliverable' and github_repo = 'findmydoc-platform\/management'/);
});

test("carry-overs re-enter approval without a Sprint assignment", async () => {
  const sprintLock = await readFile("src/app/api/sprints/[id]/lock/route.ts", "utf8");

  assert.match(sprintLock, /sprintId: null/);
  assert.match(sprintLock, /scoreRelevant: false/);
  assert.match(sprintLock, /approvalStatus: "proposed"/);
  assert.doesNotMatch(sprintLock, /sprintId: nextSprint\.id/);
  assert.doesNotMatch(sprintLock, /approvalStatus: "approved"/);
});
