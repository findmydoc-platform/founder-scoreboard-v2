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

function issueSnapshot(overrides = {}) {
  return {
    id: 101,
    nodeId: "I_issue",
    number: 17,
    title: "[Deliverable] Changed title",
    body: "",
    state: "open",
    labels: [],
    assigneeUserIds: [],
    updatedAt: "2026-08-16T12:01:00.000Z",
    ...overrides,
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

test("an authorized human change runs the FounderOps command and immediately projects desired state", async () => {
  const { store, calls } = fixture();
  const result = await processor.processGitHubPlanningWebhookDelivery({
    deliveryId: "delivery-one",
    supabase: {},
    store,
    loadIssue: async () => issueSnapshot(),
  });
  assert.deepEqual(result, { kind: "processed", reason: "founderops_updated" });
  assert.equal(domainRuns.length, 1);
  assert.deepEqual(calls.enqueued, ["task-one"]);
  assert.deepEqual(dispatched, ["github-webhook:delivery-one"]);
  assert.equal(calls.finalized.at(-1).statusReason, "founderops_updated");
});

test("an unmapped or unauthorized human cannot mutate FounderOps and is corrected in GitHub", async () => {
  const unmapped = fixture({ actor: null });
  let result = await processor.processGitHubPlanningWebhookDelivery({
    deliveryId: "delivery-one",
    supabase: {},
    store: unmapped.store,
    loadIssue: async () => issueSnapshot(),
  });
  assert.deepEqual(result, { kind: "processed", reason: "corrected_in_github" });
  assert.equal(domainRuns.length, 0);
  assert.equal(unmapped.calls.finalized.at(-1).statusReason, "actor_not_mapped");

  domainAllowed = false;
  const denied = fixture();
  result = await processor.processGitHubPlanningWebhookDelivery({
    deliveryId: "delivery-one",
    supabase: {},
    store: denied.store,
    loadIssue: async () => issueSnapshot(),
  });
  assert.deepEqual(result, { kind: "processed", reason: "corrected_in_github" });
  assert.equal(denied.calls.finalized.at(-1).statusReason, "change_not_authorized");
});

test("App-origin changes are idempotent no-ops", async () => {
  const { store, calls } = fixture({ delivery: delivery({ senderType: "Bot" }) });
  const result = await processor.processGitHubPlanningWebhookDelivery({
    deliveryId: "delivery-one",
    supabase: {},
    store,
    loadIssue: async () => issueSnapshot(),
  });
  assert.deepEqual(result, { kind: "ignored", reason: "app_projection" });
  assert.deepEqual(calls.enqueued, []);
  assert.equal(calls.finalized.at(-1).statusReason, "app_projection");
});

test("a delivery superseded by a newer Issue snapshot cannot regress FounderOps", async () => {
  const { store, calls } = fixture();
  const result = await processor.processGitHubPlanningWebhookDelivery({
    deliveryId: "delivery-one",
    supabase: {},
    store,
    loadIssue: async () => issueSnapshot({ updatedAt: "2026-08-16T12:02:00.000Z" }),
  });
  assert.deepEqual(result, { kind: "processed", reason: "corrected_in_github" });
  assert.equal(domainRuns.length, 0);
  assert.deepEqual(calls.enqueued, ["task-one"]);
  assert.deepEqual(dispatched, ["github-webhook:delivery-one"]);
  assert.equal(calls.finalized.at(-1).statusReason, "superseded");
});

test("an already-aligned retry still dispatches the durable desired-state projection", async () => {
  policyDecision = { kind: "ignored", reason: "already_aligned" };
  const { store, calls } = fixture();
  const result = await processor.processGitHubPlanningWebhookDelivery({
    deliveryId: "delivery-one",
    supabase: {},
    store,
    loadIssue: async () => issueSnapshot(),
  });
  assert.deepEqual(result, { kind: "processed", reason: "corrected_in_github" });
  assert.equal(domainRuns.length, 0);
  assert.deepEqual(calls.enqueued, ["task-one"]);
  assert.deepEqual(dispatched, ["github-webhook:delivery-one"]);
  assert.equal(calls.finalized.at(-1).statusReason, "already_aligned");
});

test("managed Issue fields are reloaded without storing their values before the domain command", async () => {
  policyDecision = { kind: "update", patch: { priority: "P1" } };
  const fieldDelivery = delivery({ action: "field_added", changedFields: ["issue_field:Priority"] });
  const { store, calls } = fixture({ delivery: fieldDelivery });
  const loaded = [];
  const result = await processor.processGitHubPlanningWebhookDelivery({
    deliveryId: "delivery-one",
    supabase: {},
    store,
    loadIssue: async () => issueSnapshot(),
    loadIssueField: async (_delivery, fieldName) => {
      loaded.push(fieldName);
      return { fieldName, fieldValue: "High" };
    },
  });
  assert.deepEqual(result, { kind: "processed", reason: "founderops_updated" });
  assert.deepEqual(loaded, ["Priority"]);
  assert.equal(domainRuns.length, 1);
  assert.deepEqual(calls.enqueued, ["task-one"]);
});

test("missing mappings are ignored and ambiguous mappings fail closed", async () => {
  const missing = fixture({ mapping: { kind: "missing" } });
  assert.deepEqual(await processor.processGitHubPlanningWebhookDelivery({
    deliveryId: "delivery-one",
    supabase: {},
    store: missing.store,
  }), { kind: "ignored", reason: "task_not_found" });

  const ambiguous = fixture({ mapping: { kind: "ambiguous" } });
  assert.deepEqual(await processor.processGitHubPlanningWebhookDelivery({
    deliveryId: "delivery-one",
    supabase: {},
    store: ambiguous.store,
  }), { kind: "failed", reason: "ambiguous_task_mapping" });
  assert.equal(ambiguous.calls.finalized.at(-1).status, "failed");
});
