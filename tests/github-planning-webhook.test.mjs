import assert from "node:assert/strict";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

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
    startDate: "",
    deadline: "",
    sprintId: "sprint-one",
    ownerId: "founder-one",
    parentTaskId: "initiative-one",
    reviewStatus: "not_requested",
    scoreFinal: false,
  };
}

function supabaseTaskReadFixture({ task, taskLinks = [], taskLinksError = null } = {}) {
  const calls = [];
  const taskQuery = {
    select(columns) {
      calls.push({ table: "tasks", method: "select", columns });
      return taskQuery;
    },
    eq(column, value) {
      calls.push({ table: "tasks", method: "eq", column, value });
      return taskQuery;
    },
    is(column, value) {
      calls.push({ table: "tasks", method: "is", column, value });
      return taskQuery;
    },
    async maybeSingle() {
      return { data: task || null, error: null };
    },
  };
  const linkQuery = {
    select(columns) {
      calls.push({ table: "task_links", method: "select", columns });
      return linkQuery;
    },
    eq(column, value) {
      calls.push({ table: "task_links", method: "eq", column, value });
      return linkQuery;
    },
    order(column) {
      calls.push({ table: "task_links", method: "order", column });
      return linkQuery;
    },
    then(resolve, reject) {
      return Promise.resolve({ data: taskLinks, error: taskLinksError }).then(resolve, reject);
    },
  };
  return {
    calls,
    supabase: {
      from(table) {
        if (table === "tasks") return taskQuery;
        if (table === "task_links") return linkQuery;
        throw new Error(`Unexpected table: ${table}`);
      },
    },
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

test("Supabase planning webhook store loads evidence links from task_links", async () => {
  const { supabase, calls } = supabaseTaskReadFixture({
    task: {
      id: "task-one",
      task_type: "deliverable",
      title: "Current title",
      evidence_link: "https://legacy.example/evidence",
      updated_at: "2026-08-18T10:00:00.000Z",
    },
    taskLinks: [
      { id: 2, position: 1, url: "https://example.com/second" },
      { id: 1, position: 0, url: "https://example.com/first" },
    ],
  });

  const store = processor.createSupabaseGitHubPlanningWebhookStore(supabase);
  const task = await store.loadTask("task-one");

  assert.deepEqual(task?.evidenceLinks, ["https://example.com/second", "https://example.com/first"]);
  assert.equal(task?.evidenceLink, "https://example.com/second");
  const taskSelect = calls.find((call) => call.table === "tasks" && call.method === "select");
  assert.ok(taskSelect);
  assert.equal(taskSelect.columns.includes("evidence_links"), false);
  assert.deepEqual(
    calls.filter((call) => call.table === "task_links"),
    [
      { table: "task_links", method: "select", columns: "url,position,id" },
      { table: "task_links", method: "eq", column: "task_id", value: "task-one" },
      { table: "task_links", method: "eq", column: "type", value: "evidence" },
      { table: "task_links", method: "order", column: "position" },
      { table: "task_links", method: "order", column: "id" },
    ],
  );
});

test("Supabase planning webhook store fails closed when evidence links cannot be loaded", async () => {
  const { supabase } = supabaseTaskReadFixture({
    task: {
      id: "task-one",
      task_type: "deliverable",
      updated_at: "2026-08-18T10:00:00.000Z",
    },
    taskLinksError: { message: "permission denied" },
  });

  const store = processor.createSupabaseGitHubPlanningWebhookStore(supabase);
  await assert.rejects(
    store.loadTask("task-one"),
    /FounderOps task evidence links could not be loaded: permission denied/,
  );
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

test("projection retries and terminal failures keep the webhook journal aligned", async () => {
  const retryAt = "2099-08-16T12:05:00.000Z";
  const retry = fixture({
    projectionState: {
      total: 1,
      completed: 0,
      outstanding: 1,
      failed: 0,
      availableAt: retryAt,
      lastError: "GitHub rate limit",
    },
  });
  assert.deepEqual(await processor.processGitHubPlanningWebhookDelivery({
    deliveryId: "delivery-one",
    supabase: {},
    store: retry.store,
    loadIssue: async () => issueSnapshot(),
  }), { kind: "retry_scheduled", reason: "processing_error" });
  assert.deepEqual(retry.calls.finalized.at(-1), {
    status: "retry_scheduled",
    statusReason: "processing_error",
    lastError: "GitHub rate limit",
    availableAt: retryAt,
  });

  const failed = fixture({
    projectionState: {
      total: 1,
      completed: 0,
      outstanding: 0,
      failed: 1,
      availableAt: null,
      lastError: "GitHub permission denied",
    },
  });
  assert.deepEqual(await processor.processGitHubPlanningWebhookDelivery({
    deliveryId: "delivery-one",
    supabase: {},
    store: failed.store,
    loadIssue: async () => issueSnapshot(),
  }), { kind: "failed", reason: "processing_error" });
  assert.equal(failed.calls.finalized.at(-1).status, "failed");
  assert.equal(failed.calls.finalized.at(-1).lastError, "GitHub permission denied");
  assert.equal(failed.calls.finalized.at(-1).availableAt, undefined);
});

test("processor failures schedule a retry and become terminal on the fifth attempt", async () => {
  const before = Date.now();
  const retry = fixture();
  assert.deepEqual(await processor.processGitHubPlanningWebhookDelivery({
    deliveryId: "delivery-one",
    supabase: {},
    store: retry.store,
    loadIssue: async () => { throw new Error("forced reload failure"); },
  }), { kind: "retry_scheduled", reason: "processing_error" });
  assert.equal(retry.calls.finalized.at(-1).status, "retry_scheduled");
  assert.equal(retry.calls.finalized.at(-1).lastError, "forced reload failure");
  assert.ok(Date.parse(retry.calls.finalized.at(-1).availableAt) > before);

  const terminal = fixture({ delivery: delivery({ attempts: 5 }) });
  assert.deepEqual(await processor.processGitHubPlanningWebhookDelivery({
    deliveryId: "delivery-one",
    supabase: {},
    store: terminal.store,
    loadIssue: async () => { throw new Error("forced terminal failure"); },
  }), { kind: "failed", reason: "processing_error" });
  assert.deepEqual(terminal.calls.finalized.at(-1), {
    status: "failed",
    statusReason: "processing_error",
    lastError: "forced terminal failure",
    availableAt: undefined,
  });
});
