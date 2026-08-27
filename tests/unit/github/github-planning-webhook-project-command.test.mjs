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

test("Project field changes use the same FounderOps authorization and immediate writeback", async () => {
  policyDecision = { kind: "update", patch: { workstream: "Operations" } };
  const project = fixture({
    delivery: delivery({
      eventName: "projects_v2_item",
      action: "edited",
      repositoryFullName: "",
      issueId: null,
      issueNodeId: "",
      issueNumber: 0,
      issueUpdatedAt: "",
      projectNodeId: "PVT_project",
      projectItemNodeId: "PVTI_item",
      projectItemUpdatedAt: "2026-08-16T12:01:00.000Z",
      projectContentNodeId: "I_issue",
      projectFieldNodeId: "PVTF_workstream",
    }),
  });
  const result = await processor.processGitHubPlanningWebhookDelivery({
    deliveryId: "delivery-one",
    supabase: {},
    store: project.store,
    loadProject: async () => ({
      repositoryFullName: "findmydoc-platform/management",
      issueNumber: 17,
      projectNodeId: "PVT_project",
      projectItemNodeId: "PVTI_item",
      projectItemActive: true,
      projectItemUpdatedAt: "2026-08-16T12:01:00.000Z",
      changedFieldName: "Workstream",
      changedFieldValue: "Operations",
    }),
  });
  assert.deepEqual(result, { kind: "processed", reason: "founderops_updated" });
  assert.equal(domainRuns.length, 1);
  assert.deepEqual(project.calls.enqueued, ["task-one"]);
  assert.equal(project.calls.finalized.at(-1).statusReason, "founderops_updated");
});

test("an unmapped Project actor cannot mutate FounderOps", async () => {
  policyDecision = { kind: "update", patch: { workstream: "Operations" } };
  const project = fixture({
    actor: null,
    delivery: delivery({
      eventName: "projects_v2_item",
      action: "edited",
      repositoryFullName: "",
      issueId: null,
      issueNodeId: "",
      issueNumber: 0,
      issueUpdatedAt: "",
      projectNodeId: "PVT_project",
      projectItemNodeId: "PVTI_item",
      projectItemUpdatedAt: "2026-08-16T12:01:00.000Z",
      projectContentNodeId: "I_issue",
      projectFieldNodeId: "PVTF_workstream",
    }),
  });
  const result = await processor.processGitHubPlanningWebhookDelivery({
    deliveryId: "delivery-one",
    supabase: {},
    store: project.store,
    loadProject: async () => ({
      repositoryFullName: "findmydoc-platform/management",
      issueNumber: 17,
      projectNodeId: "PVT_project",
      projectItemNodeId: "PVTI_item",
      projectItemActive: true,
      projectItemUpdatedAt: "2026-08-16T12:01:00.000Z",
      changedFieldName: "Workstream",
      changedFieldValue: "Operations",
    }),
  });
  assert.deepEqual(result, { kind: "processed", reason: "corrected_in_github" });
  assert.equal(domainRuns.length, 0);
  assert.equal(project.calls.finalized.at(-1).statusReason, "actor_not_mapped");
});

test("a missing or newer Project item is corrected without mutating FounderOps", async () => {
  policyDecision = { kind: "update", patch: { workstream: "Operations" } };
  for (const observation of [
    { projectItemActive: false, projectItemUpdatedAt: null },
    { projectItemActive: true, projectItemUpdatedAt: "2026-08-16T12:02:00.000Z" },
  ]) {
    const project = fixture({
      delivery: delivery({
        eventName: "projects_v2_item",
        action: "edited",
        repositoryFullName: "",
        issueId: null,
        issueNodeId: "",
        issueNumber: 0,
        issueUpdatedAt: "",
        projectNodeId: "PVT_project",
        projectItemNodeId: "PVTI_item",
        projectItemUpdatedAt: "2026-08-16T12:01:00.000Z",
        projectContentNodeId: "I_issue",
        projectFieldNodeId: "PVTF_workstream",
      }),
    });
    const result = await processor.processGitHubPlanningWebhookDelivery({
      deliveryId: "delivery-one",
      supabase: {},
      store: project.store,
      loadProject: async () => ({
        repositoryFullName: "findmydoc-platform/management",
        issueNumber: 17,
        projectNodeId: "PVT_project",
        projectItemNodeId: "PVTI_item",
        ...observation,
        changedFieldName: null,
        changedFieldValue: null,
      }),
    });
    assert.deepEqual(result, { kind: "processed", reason: "corrected_in_github" });
    assert.equal(project.calls.finalized.at(-1).statusReason, "superseded");
  }
  assert.equal(domainRuns.length, 0);
});
