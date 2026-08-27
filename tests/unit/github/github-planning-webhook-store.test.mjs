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
