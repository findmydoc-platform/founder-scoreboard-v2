import assert from "node:assert/strict";
import { test } from "vitest";
import { loadTranspiledModule } from "../../helpers/transpile-module.mjs";

const projectFieldContext = await loadTranspiledModule("src/lib/github-sync/project-field-context.ts");
const policy = await loadTranspiledModule("src/lib/github-planning-webhook-policy.ts", {
  "./github-sync/project-field-context": projectFieldContext,
});

function task(overrides = {}) {
  return {
    id: "task-one",
    taskType: "deliverable",
    updatedAt: "2026-08-16T12:00:00.000Z",
    title: "Current title",
    description: "",
    problemStatement: "Current problem",
    intendedOutcome: "Current outcome",
    scopeConstraints: "Current scope",
    acceptanceCriteria: "Current criterion",
    evidenceRequired: "Current evidence",
    definitionOfDone: "Current done",
    status: "In Arbeit",
    priority: "P2",
    workstream: "Product",
    hours: 8,
    evidenceLink: "https://example.com/evidence",
    evidenceLinks: ["https://example.com/evidence"],
    fixedDate: "2026-08-20",
    sprintId: "sprint-one",
    ownerId: "founder-one",
    parentTaskId: "initiative-one",
    reviewStatus: "not_requested",
    scoreFinal: false,
    ...overrides,
  };
}

function issue(overrides = {}) {
  return {
    id: 101,
    nodeId: "I_issue",
    number: 17,
    title: "[Deliverable] Changed title",
    body: [
      "## Problem Statement",
      "Changed problem",
      "",
      "## Intended Outcome",
      "Changed outcome",
      "",
      "## Scope & Constraints",
      "- First scope",
      "",
      "## Acceptance Criteria",
      "- First criterion",
      "",
      "## Evidence Required",
      "Changed evidence",
      "",
      "## Definition of Done",
      "- First done item",
      "",
      "---",
      "Planning context: FounderOps.",
      "<!-- founderops-task-id:task-one -->",
    ].join("\n"),
    state: "open",
    labels: [],
    assigneeUserIds: [],
    updatedAt: "2026-08-16T12:01:00.000Z",
    ...overrides,
  };
}

function decide(action, changedFields, options = {}) {
  return policy.decideGitHubIssuePlanningChange({
    delivery: {
      action,
      changedFields,
      targetUserId: options.targetUserId || null,
    },
    issue: options.issue || issue(),
    task: options.task || task(),
    targetProfileId: options.targetProfileId || null,
  });
}

test("managed title and structured body edits become one atomic FounderOps patch", () => {
  const decision = decide("edited", ["title", "body"]);
  assert.equal(decision.kind, "update");
  assert.deepEqual(decision.patch, {
    title: "Changed title",
    problemStatement: "Changed problem",
    intendedOutcome: "Changed outcome",
    scopeConstraints: "First scope",
    acceptanceCriteria: "First criterion",
    evidenceRequired: "Changed evidence",
    definitionOfDone: "First done item",
  });
});

test("free text, unknown sections, and a mismatched marker are fail-closed", () => {
  for (const body of [
    `free text\n${issue().body}`,
    issue().body.replace("## Intended Outcome", "## Unknown"),
    issue().body.replace("task-one", "task-two"),
  ]) {
    const decision = decide("edited", ["body"], { issue: issue({ body }) });
    assert.equal(decision.kind, "reconcile");
  }
});

test("owned label additions map to explicit desired state while removals reconcile", () => {
  assert.deepEqual(decide("labeled", ["label:p1-high"], { issue: issue({ labels: ["P1-High"] }) }), {
    kind: "update",
    patch: { priority: "P1" },
  });
  assert.deepEqual(decide("labeled", ["label:blocked"], { issue: issue({ labels: ["blocked"] }) }), {
    kind: "update",
    patch: { status: "Blockiert" },
  });
  assert.deepEqual(decide("labeled", ["label:review:ready"], { issue: issue({ labels: ["review:ready"] }) }), { kind: "request_review" });
  assert.deepEqual(decide("unlabeled", ["label:p1-high"]), {
    kind: "reconcile",
    reason: "managed_label_removed",
  });
  assert.deepEqual(decide("labeled", ["label:customer" ]), {
    kind: "ignored",
    reason: "unowned_change",
  });
});

test("milestones stay GitHub-owned and assignment requires an exact stable identity", () => {
  assert.deepEqual(decide("milestoned", []), { kind: "ignored", reason: "unowned_change" });
  assert.deepEqual(decide("assigned", ["assignee"], { targetUserId: 42 }), {
    kind: "reconcile",
    reason: "assignee_not_mapped",
  });
  assert.deepEqual(decide("assigned", ["assignee"], {
    issue: issue({ assigneeUserIds: [42] }),
    targetUserId: 42,
    targetProfileId: "founder-two",
  }), {
    kind: "update",
    patch: { ownerId: "founder-two" },
  });
  assert.deepEqual(decide("unassigned", ["assignee"], { targetUserId: 42 }), {
    kind: "reconcile",
    reason: "assignee_removal_has_no_desired_owner",
  });
});

test("close and reopen are explicit status transitions", () => {
  assert.deepEqual(decide("closed", ["state"], { issue: issue({ state: "closed" }) }), {
    kind: "update",
    patch: { status: "Erledigt" },
  });
  assert.deepEqual(decide("reopened", ["state"], { task: task({ status: "Erledigt" }) }), {
    kind: "update",
    patch: { status: "Offen" },
  });
  assert.deepEqual(decide("closed", ["state"], { task: task({ status: "Erledigt" }) }), {
    kind: "update",
    patch: { status: "Offen" },
  });
});

test("ambiguous GitHub Low priority never guesses between FounderOps P3 and P4", () => {
  assert.equal(policy.githubIssuePriorityToFounderOps("Low"), null);
  assert.equal(policy.githubIssuePriorityToFounderOps("Medium"), "P2");
});

test("managed Issue schedule fields update only fixedDate and reconcile Start date to empty", () => {
  assert.equal(policy.isFounderOpsManagedGitHubIssueField("Priority"), true);
  assert.equal(policy.isFounderOpsManagedGitHubIssueField("Effort"), false);
  assert.deepEqual(policy.decideGitHubIssueFieldPlanningChange({
    fieldName: "Start date",
    fieldValue: "2026-08-18",
    task: task(),
  }), {
    kind: "reconcile",
    reason: "start_date_is_founderops_owned_empty",
  });
  assert.deepEqual(policy.decideGitHubIssueFieldPlanningChange({
    fieldName: "Target date",
    fieldValue: "2026-08-21",
    task: task(),
  }), {
    kind: "update",
    patch: { fixedDate: "2026-08-21" },
  });
});

test("managed Project fields become FounderOps changes while unowned fields stay untouched", () => {
  const decideProject = (changedFieldName, changedFieldValue, options = {}) => (
    policy.decideGitHubProjectPlanningChange({
      delivery: { action: options.action || "edited" },
      project: { changedFieldName, changedFieldValue },
      task: options.task || task(),
      resolvedSprintId: options.resolvedSprintId,
    })
  );

  assert.deepEqual(decideProject("Status", "Blocked"), {
    kind: "update",
    patch: { status: "Blockiert" },
  });
  assert.deepEqual(decideProject("Status", "Review"), { kind: "request_review" });
  assert.deepEqual(decideProject("Sprint", { title: "Sprint 2", startDate: "2026-08-24" }, {
    resolvedSprintId: "sprint-two",
  }), {
    kind: "update",
    patch: { sprintId: "sprint-two" },
  });
  assert.deepEqual(decideProject("Estimate hours", 13), {
    kind: "update",
    patch: { hours: 13 },
  });
  assert.deepEqual(decideProject("Effort", "Large"), {
    kind: "ignored",
    reason: "unowned_change",
  });
});

test("ambiguous or lossy Project edits reconcile to FounderOps desired state", () => {
  const decideProject = (changedFieldName, changedFieldValue, options = {}) => (
    policy.decideGitHubProjectPlanningChange({
      delivery: { action: options.action || "edited" },
      project: { changedFieldName, changedFieldValue },
      task: options.task || task(),
      resolvedSprintId: options.resolvedSprintId,
    })
  );

  assert.deepEqual(decideProject("Estimate hours", 13.2), {
    kind: "reconcile",
    reason: "project_estimate_invalid",
  });

  assert.equal(decideProject("Priority", "Low").kind, "reconcile");
  assert.equal(decideProject("Sprint", { title: "Unknown", startDate: "2026-08-24" }).kind, "reconcile");
  assert.equal(decideProject("Evidence URL", "javascript:alert(1)").kind, "reconcile");
  assert.equal(decideProject("Evidence URL", "https://new.example", {
    task: task({ evidenceLinks: ["https://one.example", "https://two.example"] }),
  }).kind, "reconcile");
  assert.equal(decideProject(null, null, { action: "deleted" }).kind, "reconcile");
});
