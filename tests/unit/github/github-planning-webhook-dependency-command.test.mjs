import assert from "node:assert/strict";

import { test } from "vitest";

import { loadTranspiledModule } from "../../helpers/transpile-module.mjs";

let policyDecision = { kind: "update", patch: { title: "Changed title" } };

let domainAllowed = true;

const dispatched = [];

const domainRuns = [];

const relationshipRuns = [];

const processor = await loadTranspiledModule("src/lib/github-planning-webhook.ts", {
  "server-only": {},
  "@/features/planning-items/model/planning-item-update": {
    parsePlanningItemPatchPayload: (raw) => ({
      ok: true,
      expectedUpdatedAt: raw.expectedUpdatedAt,
      presentFields: Object.keys(raw).filter((field) => field !== "expectedUpdatedAt"),
      raw,
    }),
    buildPlanningItemUpdatePreview: async ({ parsed, itemId }) => ({
      ok: true,
      preview: {
        itemId,
        itemType: "deliverable",
        expectedUpdatedAt: parsed.expectedUpdatedAt,
        normalizedPatch: parsed.raw,
        changedFields: ["title"],
        systemEffects: [{ field: "githubIssueSyncStatus", after: "not_synced" }],
        dbPatch: { title: parsed.raw.title },
        errors: domainAllowed ? [] : ["forbidden"],
      },
    }),
    createBrowserRevisePlanningItems: () => ({
      run: async (invocation) => {
        domainRuns.push(invocation);
        return { ok: true, status: "committed" };
      },
    }),
    planningItemReviseCommand: (itemId, itemType, expectedRevision, patch) => ({ itemId, itemType, expectedRevision, patch }),
  },
  "@/features/planning-items/model/planning-items-github-projection": {
    dispatchPlanningGitHubProjections: async ({ operationId }) => {
      dispatched.push(operationId);
      return { claimed: 1, completed: 1, retryScheduled: 0, failed: 0, results: new Map() };
    },
  },
  "@/features/planning-items/model/planning-items-review": {
    createPlanningReviewPlanningItems: () => ({ run: async () => ({ ok: true, status: "committed" }) }),
    requestPlanningReviewCommand: (itemId, input) => ({ itemId, input }),
  },
  "@/features/planning-items/model/planning-items-reparent": {
    changePlanningParentCommand: (itemId, parentId, expectedRevision) => ({ kind: "reparent", itemId, parentId, expectedRevision }),
    createPlanningReparentPlanningItems: () => ({
      run: async (invocation) => {
        relationshipRuns.push(invocation);
        return { ok: true, status: "committed" };
      },
    }),
  },
  "@/features/planning-items/model/planning-items-relationships": {
    addPlanningRelationshipCommand: (itemId, input) => ({ kind: "add", itemId, input }),
    removePlanningRelationshipCommand: (itemId, input) => ({ kind: "remove", itemId, input }),
    createPlanningRelationshipPlanningItems: () => ({
      run: async (invocation) => {
        relationshipRuns.push(invocation);
        return { ok: true, status: "committed" };
      },
    }),
  },
  "./github": { getGitHubIssue: async () => ({}) },
  "./github-app": { getGitHubAppInstallationToken: async () => "token" },
  "./github-sync/project-observation": {
    loadGitHubPlanningIssueFieldObservation: async () => ({}),
    loadGitHubPlanningProjectObservation: async () => ({}),
  },
  "./github-sync/relationship-observation": {
    loadGitHubDependencyObservation: async () => false,
    loadGitHubSubIssueParentObservation: async () => null,
  },
  "./github-planning-webhook-policy": {
    decideGitHubIssueFieldPlanningChange: () => policyDecision,
    decideGitHubIssuePlanningChange: () => policyDecision,
    decideGitHubProjectPlanningChange: () => policyDecision,
    isFounderOpsManagedGitHubIssueField: (fieldName) => ["Priority", "Start date", "Target date"].includes(fieldName),
  },
});

function delivery(overrides = {}) {
  return {
    deliveryId: "delivery-one",
    eventName: "issues",
    action: "edited",
    repositoryFullName: "findmydoc-platform/management",
    issueId: 101,
    issueNodeId: "I_issue",
    issueNumber: 17,
    issueUpdatedAt: "2026-08-16T12:01:00.000Z",
    relatedRepositoryFullName: "",
    relatedIssueId: null,
    relatedIssueNodeId: "",
    relatedIssueNumber: null,
    relatedIssueUpdatedAt: "",
    projectNodeId: "",
    projectItemNodeId: "",
    projectItemUpdatedAt: "",
    projectContentNodeId: "",
    projectFieldNodeId: "",
    changedFields: ["title"],
    targetUserId: null,
    senderId: 42,
    senderType: "User",
    attempts: 1,
    ...overrides,
  };
}

function taskSnapshot() {
  return {
    id: "task-one",
    taskType: "deliverable",
    updatedAt: "2026-08-16T12:00:00.000Z",
    title: "Current title",
    description: "",
    problemStatement: "",
    intendedOutcome: "",
    scopeConstraints: "",
    acceptanceCriteria: "",
    evidenceRequired: "",
    definitionOfDone: "",
    status: "In Arbeit",
    priority: "P2",
    workstream: "Product",
    hours: 8,
    evidenceLink: "",
    evidenceLinks: [],
    fixedDate: "",
    sprintId: "sprint-one",
    ownerId: "founder-one",
    parentTaskId: "initiative-one",
    reviewStatus: "not_requested",
    scoreFinal: false,
  };
}

function fixture(options = {}) {
  const calls = { enqueued: [], finalized: [] };
  const store = {
    claim: async () => options.delivery || delivery(),
    resolveTask: async () => options.mapping || { kind: "found", taskId: "task-one" },
    resolveSprint: async () => ({ kind: "found", taskId: "sprint-two" }),
    resolveActor: async (githubUserId) => githubUserId && options.actor !== null
      ? { profileId: "founder-one", name: "Founder One", platformRole: "founder" }
      : null,
    loadTask: async () => taskSnapshot(),
    findBlockedByRelationship: async () => options.relationship || null,
    enqueueProjection: async (_deliveryId, _lockToken, taskId) => {
      calls.enqueued.push(taskId);
      return "github-webhook:delivery-one";
    },
    loadProjectionState: async () => options.projectionState || {
      total: new Set(calls.enqueued).size,
      completed: new Set(calls.enqueued).size,
      outstanding: 0,
      failed: 0,
      availableAt: null,
      lastError: null,
    },
    finalize: async (_deliveryId, _lockToken, input) => {
      calls.finalized.push(input);
      return true;
    },
  };
  return { store, calls };
}

test.beforeEach(() => {
  policyDecision = { kind: "update", patch: { title: "Changed title" } };
  domainAllowed = true;
  dispatched.length = 0;
  domainRuns.length = 0;
  relationshipRuns.length = 0;
});

test("relationship events apply only the matching reloaded event version", async () => {
  const subIssueDelivery = delivery({
    eventName: "sub_issues",
    action: "sub_issue_added",
    relatedRepositoryFullName: "findmydoc-platform/management",
    relatedIssueId: 102,
    relatedIssueNodeId: "I_child",
    relatedIssueNumber: 18,
    relatedIssueUpdatedAt: "2026-08-16T12:01:00.000Z",
  });
  let resolveCalls = 0;
  const subIssue = fixture({ delivery: subIssueDelivery });
  subIssue.store.resolveTask = async () => ({ kind: "found", taskId: resolveCalls++ ? "parent" : "child" });
  subIssue.store.loadTask = async (taskId) => taskId === "parent"
    ? { ...taskSnapshot(), id: "parent" }
    : { ...taskSnapshot(), id: "child", taskType: "sub_issue", parentTaskId: "other-parent" };
  let result = await processor.processGitHubPlanningWebhookDelivery({
    deliveryId: "delivery-one",
    supabase: {},
    store: subIssue.store,
    loadRelationship: async () => ({
      kind: "sub_issue",
      parent: { repositoryFullName: "findmydoc-platform/management", issueNumber: 17 },
      primaryUpdatedAt: "2026-08-16T12:01:00.000Z",
      relatedUpdatedAt: "2026-08-16T12:01:00.000Z",
    }),
  });
  assert.deepEqual(result, { kind: "processed", reason: "founderops_updated" });
  assert.equal(relationshipRuns.at(-1).command.kind, "reparent");
  assert.deepEqual(subIssue.calls.enqueued.sort(), ["child", "parent"]);

  relationshipRuns.length = 0;
  resolveCalls = 0;
  const dependency = fixture({
    delivery: delivery({
      eventName: "issue_dependencies",
      action: "blocked_by_added",
      relatedRepositoryFullName: "findmydoc-platform/management",
      relatedIssueId: 103,
      relatedIssueNodeId: "I_blocking",
      relatedIssueNumber: 18,
      relatedIssueUpdatedAt: "2026-08-16T12:01:00.000Z",
    }),
  });
  dependency.store.resolveTask = async () => ({ kind: "found", taskId: resolveCalls++ ? "blocking" : "blocked" });
  dependency.store.loadTask = async (taskId) => ({ ...taskSnapshot(), id: taskId });
  result = await processor.processGitHubPlanningWebhookDelivery({
    deliveryId: "delivery-one",
    supabase: {},
    store: dependency.store,
    loadRelationship: async () => ({
      kind: "dependency",
      exists: true,
      primaryUpdatedAt: "2026-08-16T12:01:00.000Z",
      relatedUpdatedAt: "2026-08-16T12:01:00.000Z",
    }),
  });
  assert.deepEqual(result, { kind: "processed", reason: "founderops_updated" });
  assert.equal(relationshipRuns.at(-1).command.kind, "add");
});

test("a newer or mismatched relationship state cannot borrow the delivery actor", async () => {
  const stale = fixture({
    delivery: delivery({
      eventName: "issue_dependencies",
      action: "blocked_by_removed",
      relatedRepositoryFullName: "findmydoc-platform/management",
      relatedIssueId: 103,
      relatedIssueNodeId: "I_blocking",
      relatedIssueNumber: 18,
      relatedIssueUpdatedAt: "2026-08-16T12:01:00.000Z",
    }),
  });
  let resolveCalls = 0;
  stale.store.resolveTask = async () => ({ kind: "found", taskId: resolveCalls++ ? "blocking" : "blocked" });
  stale.store.loadTask = async (taskId) => ({ ...taskSnapshot(), id: taskId });
  const result = await processor.processGitHubPlanningWebhookDelivery({
    deliveryId: "delivery-one",
    supabase: {},
    store: stale.store,
    loadRelationship: async () => ({
      kind: "dependency",
      exists: true,
      primaryUpdatedAt: "2026-08-16T12:02:00.000Z",
      relatedUpdatedAt: "2026-08-16T12:01:00.000Z",
    }),
  });
  assert.deepEqual(result, { kind: "processed", reason: "corrected_in_github" });
  assert.equal(relationshipRuns.length, 0);
  assert.deepEqual(stale.calls.enqueued.sort(), ["blocked", "blocking"]);
  assert.equal(stale.calls.finalized.at(-1).statusReason, "superseded");
});

test("unmapped relationship actors cannot mutate FounderOps", async () => {
  const relationshipDelivery = delivery({
    eventName: "issue_dependencies",
    action: "blocked_by_added",
    relatedRepositoryFullName: "findmydoc-platform/website",
    relatedIssueId: 103,
    relatedIssueNodeId: "I_blocking",
    relatedIssueNumber: 18,
    relatedIssueUpdatedAt: "2026-08-16T12:01:00.000Z",
  });
  const relationship = fixture({ actor: null, delivery: relationshipDelivery });
  let resolveCalls = 0;
  relationship.store.resolveTask = async () => ({ kind: "found", taskId: resolveCalls++ ? "blocking" : "blocked" });
  relationship.store.loadTask = async (taskId) => ({ ...taskSnapshot(), id: taskId });
  const result = await processor.processGitHubPlanningWebhookDelivery({
    deliveryId: "delivery-one",
    supabase: {},
    store: relationship.store,
    loadRelationship: async () => ({
      kind: "dependency",
      exists: true,
      primaryUpdatedAt: "2026-08-16T12:01:00.000Z",
      relatedUpdatedAt: "2026-08-16T12:01:00.000Z",
    }),
  });
  assert.deepEqual(result, { kind: "processed", reason: "corrected_in_github" });
  assert.equal(relationshipRuns.length, 0);
  assert.equal(relationship.calls.finalized.at(-1).statusReason, "actor_not_mapped");
});
