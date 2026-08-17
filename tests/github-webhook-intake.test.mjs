import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const webhookSecret = "test-webhook-secret";
const expectedInstallationId = "42";
const expectedOrganizationId = "606";
const allowedRepositories = new Set([
  "findmydoc-platform/management",
  "findmydoc-platform/website",
  "findmydoc-platform/clinic-dashboard",
]);

const webhook = await loadTranspiledModule("src/lib/github-webhook-intake.ts", {
  "server-only": {},
  "./github-repositories": {
    normalizeGitHubRepository: (value) => allowedRepositories.has(value) ? value : null,
  },
});

function issuePayload(overrides = {}) {
  return {
    action: "edited",
    installation: { id: 42 },
    repository: {
      id: 101,
      full_name: "findmydoc-platform/management",
    },
    issue: {
      id: 202,
      node_id: "I_kwDOExample",
      number: 17,
      title: "Webhook intake",
      body: "Verified payload",
      updated_at: "2026-08-14T12:30:00Z",
    },
    sender: {
      id: 303,
      login: "founder",
    },
    ...overrides,
  };
}

function commentPayload(overrides = {}) {
  return issuePayload({
    action: "created",
    comment: {
      id: 404,
      node_id: "IC_kwDOExample",
      body: "Comment content must not be persisted.",
      updated_at: "2026-08-14T12:31:00Z",
    },
    ...overrides,
  });
}

function signedEnvelope(body, {
  deliveryId = "delivery-123",
  eventName = "issues",
  secret = webhookSecret,
} = {}) {
  const rawBody = Buffer.from(typeof body === "string" ? body : JSON.stringify(body));
  return {
    rawBody,
    headers: {
      deliveryId,
      eventName,
      signature: `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`,
    },
  };
}

function inspect(body, envelopeOptions = {}, intakeOptions = {}) {
  return webhook.inspectGitHubIssueWebhook({
    ...signedEnvelope(body, envelopeOptions),
    webhookSecret,
    expectedInstallationId,
    expectedOrganizationId,
    ...intakeOptions,
  });
}

test("a signed Issue event is normalized around stable GitHub identities", () => {
  const payload = issuePayload();
  const envelope = signedEnvelope(payload);
  const result = webhook.inspectGitHubIssueWebhook({
    ...envelope,
    webhookSecret,
    expectedInstallationId,
  });

  assert.equal(result.kind, "accepted");
  assert.deepEqual(result.delivery, {
    deliveryId: "delivery-123",
    eventName: "issues",
    action: "edited",
    installationId: 42,
    organizationId: null,
    organizationLogin: null,
    repositoryId: 101,
    repositoryFullName: "findmydoc-platform/management",
    issueId: 202,
    issueNodeId: "I_kwDOExample",
    issueNumber: 17,
    issueUpdatedAt: "2026-08-14T12:30:00Z",
    relatedRepositoryId: null,
    relatedRepositoryFullName: null,
    relatedIssueId: null,
    relatedIssueNodeId: null,
    relatedIssueNumber: null,
    relatedIssueUpdatedAt: null,
    projectNodeId: null,
    projectItemNodeId: null,
    projectItemUpdatedAt: null,
    projectContentNodeId: null,
    projectContentType: null,
    projectFieldNodeId: null,
    changedFields: [],
    targetUserId: null,
    targetUserLogin: null,
    commentId: null,
    commentNodeId: null,
    commentUpdatedAt: null,
    senderId: 303,
    senderLogin: "founder",
    senderType: null,
    payloadSha256: createHash("sha256").update(envelope.rawBody).digest("hex"),
  });
});

test("Issue field events persist only the field name and reload values later", () => {
  const result = inspect(issuePayload({
    action: "field_added",
    field: {
      name: "Priority",
      type: "single_select",
      value: "High",
      previous_value: "Medium",
    },
  }));

  assert.equal(result.kind, "accepted");
  assert.deepEqual(result.delivery.changedFields, ["issue_field:Priority"]);
  assert.equal(JSON.stringify(result.delivery).includes("High"), false);
  assert.equal(JSON.stringify(result.delivery).includes("Medium"), false);
  assert.equal(Object.hasOwn(result.delivery, "field"), false);
});

test("a signed Issue comment event stores stable identities without comment content", () => {
  const payload = commentPayload();
  const envelope = signedEnvelope(payload, { eventName: "issue_comment" });
  const result = webhook.inspectGitHubIssueWebhook({
    ...envelope,
    webhookSecret,
    expectedInstallationId,
  });

  assert.equal(result.kind, "accepted");
  assert.deepEqual(result.delivery, {
    deliveryId: "delivery-123",
    eventName: "issue_comment",
    action: "created",
    installationId: 42,
    organizationId: null,
    organizationLogin: null,
    repositoryId: 101,
    repositoryFullName: "findmydoc-platform/management",
    issueId: 202,
    issueNodeId: "I_kwDOExample",
    issueNumber: 17,
    issueUpdatedAt: "2026-08-14T12:30:00Z",
    relatedRepositoryId: null,
    relatedRepositoryFullName: null,
    relatedIssueId: null,
    relatedIssueNodeId: null,
    relatedIssueNumber: null,
    relatedIssueUpdatedAt: null,
    projectNodeId: null,
    projectItemNodeId: null,
    projectItemUpdatedAt: null,
    projectContentNodeId: null,
    projectContentType: null,
    projectFieldNodeId: null,
    changedFields: [],
    targetUserId: null,
    targetUserLogin: null,
    commentId: 404,
    commentNodeId: "IC_kwDOExample",
    commentUpdatedAt: "2026-08-14T12:31:00Z",
    senderId: 303,
    senderLogin: "founder",
    senderType: null,
    payloadSha256: createHash("sha256").update(envelope.rawBody).digest("hex"),
  });
  assert.equal(Object.hasOwn(result.delivery, "body"), false);
  assert.equal(Object.hasOwn(result.delivery, "commentBody"), false);
});

test("signature verification happens before payload parsing", () => {
  const invalidSignature = webhook.inspectGitHubIssueWebhook({
    rawBody: Buffer.from("not-json"),
    headers: {
      deliveryId: "delivery-123",
      eventName: "issues",
      signature: "sha256=" + "0".repeat(64),
    },
    webhookSecret,
    expectedInstallationId,
  });
  assert.equal(invalidSignature.kind, "rejected");
  assert.equal(invalidSignature.status, 401);
  assert.equal(invalidSignature.code, "github_webhook_unauthorized");

  const invalidPayload = inspect("not-json");
  assert.equal(invalidPayload.kind, "rejected");
  assert.equal(invalidPayload.status, 400);
  assert.equal(invalidPayload.code, "github_webhook_invalid_payload");
});

test("ping is acknowledged and signed unsupported events are ignored", () => {
  assert.deepEqual(inspect({ zen: "Keep it logically awesome." }, { eventName: "ping" }), { kind: "ping" });
  assert.deepEqual(inspect("not-json", { eventName: "pull_request" }), { kind: "ignored" });
});

test("the installation, repository, and Issue shape are fail-closed", () => {
  const wrongInstallation = inspect(issuePayload({ installation: { id: 43 } }));
  assert.equal(wrongInstallation.kind, "rejected");
  assert.equal(wrongInstallation.status, 403);
  assert.equal(wrongInstallation.code, "github_webhook_wrong_installation");

  const wrongRepository = inspect(issuePayload({
    repository: { id: 101, full_name: "external/example" },
  }));
  assert.equal(wrongRepository.kind, "rejected");
  assert.equal(wrongRepository.status, 403);
  assert.equal(wrongRepository.code, "github_webhook_wrong_repository");

  const pullRequest = issuePayload();
  pullRequest.issue.pull_request = { url: "https://api.github.com/repos/example/pulls/17" };
  const wrongResource = inspect(pullRequest);
  assert.equal(wrongResource.kind, "rejected");
  assert.equal(wrongResource.status, 400);
  assert.equal(wrongResource.code, "github_webhook_not_issue");
});

test("Issue comment intake ignores pull-request comments and unknown actions", () => {
  const pullRequestComment = commentPayload();
  pullRequestComment.issue.pull_request = { url: "https://api.github.com/repos/example/pulls/17" };
  assert.deepEqual(inspect(pullRequestComment, { eventName: "issue_comment" }), { kind: "ignored" });

  assert.deepEqual(
    inspect(commentPayload({ action: "pinned" }), { eventName: "issue_comment" }),
    { kind: "ignored" },
  );
});

test("Issue planning intake ignores actions outside the explicit write contract", () => {
  assert.deepEqual(inspect(issuePayload({ action: "opened" })), { kind: "ignored" });
  assert.deepEqual(inspect(issuePayload({ action: "pinned" })), { kind: "ignored" });
});

test("Issue comment intake accepts every documented action", () => {
  for (const action of ["created", "edited", "deleted"]) {
    const result = inspect(commentPayload({ action }), { eventName: "issue_comment" });
    assert.equal(result.kind, "accepted");
    assert.equal(result.delivery.action, action);
    assert.equal(result.delivery.eventName, "issue_comment");
  }
});

test("Issue comment intake rejects incomplete comment identities", () => {
  const missingComment = commentPayload();
  delete missingComment.comment;
  const missing = inspect(missingComment, { eventName: "issue_comment" });
  assert.equal(missing.kind, "rejected");
  assert.equal(missing.status, 400);
  assert.equal(missing.code, "github_webhook_invalid_payload");

  const invalidTimestamp = commentPayload({
    comment: { id: 404, node_id: "IC_kwDOExample", updated_at: "not-a-date" },
  });
  const invalid = inspect(invalidTimestamp, { eventName: "issue_comment" });
  assert.equal(invalid.kind, "rejected");
  assert.equal(invalid.status, 400);
  assert.equal(invalid.code, "github_webhook_invalid_payload");
});

test("relationship and Project events retain only stable identities and changed field names", () => {
  const subIssue = inspect({
    action: "sub_issue_added",
    installation: { id: 42 },
    repository: { id: 101, full_name: "findmydoc-platform/management" },
    parent_issue: { id: 202, node_id: "I_parent", number: 17, updated_at: "2026-08-14T12:30:00Z" },
    parent_issue_repo: { id: 101, full_name: "findmydoc-platform/management" },
    sub_issue: { id: 203, node_id: "I_child", number: 18, updated_at: "2026-08-14T12:31:00Z" },
    sub_issue_repo: { id: 101, full_name: "findmydoc-platform/management" },
    sender: { id: 303, login: "founder", type: "User" },
  }, { eventName: "sub_issues" });
  assert.equal(subIssue.kind, "accepted");
  assert.equal(subIssue.delivery.issueNumber, 17);
  assert.equal(subIssue.delivery.issueUpdatedAt, "2026-08-14T12:30:00Z");
  assert.equal(subIssue.delivery.relatedIssueNumber, 18);
  assert.equal(subIssue.delivery.relatedIssueUpdatedAt, "2026-08-14T12:31:00Z");
  assert.deepEqual(subIssue.delivery.changedFields, ["parentTaskId"]);

  const dependency = inspect({
    action: "blocked_by_added",
    installation: { id: 42 },
    repository: { id: 101, full_name: "findmydoc-platform/management" },
    blocked_issue: { id: 202, node_id: "I_blocked", number: 17, updated_at: "2026-08-14T12:30:00Z" },
    blocking_issue: { id: 203, node_id: "I_blocking", number: 18, updated_at: "2026-08-14T12:31:00Z" },
    blocking_issue_repo: { id: 101, full_name: "findmydoc-platform/management" },
    sender: { id: 303, login: "founder", type: "User" },
  }, { eventName: "issue_dependencies" });
  assert.equal(dependency.kind, "accepted");
  assert.equal(dependency.delivery.issueNumber, 17);
  assert.equal(dependency.delivery.issueUpdatedAt, "2026-08-14T12:30:00Z");
  assert.equal(dependency.delivery.relatedIssueNumber, 18);
  assert.equal(dependency.delivery.relatedIssueUpdatedAt, "2026-08-14T12:31:00Z");
  assert.deepEqual(dependency.delivery.changedFields, ["blockedBy"]);

  const project = inspect({
    action: "edited",
    organization: { id: 606, login: "findmydoc-platform" },
    projects_v2_item: {
      node_id: "PVTI_item",
      project_node_id: "PVT_project",
      content_node_id: "I_issue",
      content_type: "Issue",
      updated_at: "2026-08-14T12:31:00Z",
    },
    changes: { field_value: { field_node_id: "PVTF_status", field_type: "single_select" } },
    sender: { id: 303, login: "founder", type: "User" },
  }, { eventName: "projects_v2_item" });
  assert.equal(project.kind, "accepted");
  assert.equal(project.delivery.projectNodeId, "PVT_project");
  assert.equal(project.delivery.projectItemNodeId, "PVTI_item");
  assert.equal(project.delivery.projectItemUpdatedAt, "2026-08-14T12:31:00Z");
  assert.equal(project.delivery.projectContentNodeId, "I_issue");
  assert.equal(project.delivery.projectFieldNodeId, "PVTF_status");
  assert.equal(project.delivery.installationId, null);
  assert.equal(project.delivery.organizationId, 606);
  assert.deepEqual(project.delivery.changedFields, ["field_value"]);
  assert.equal(Object.hasOwn(project.delivery, "payload"), false);
});

test("relationship intake accepts only the documented GitHub actions", () => {
  const subIssuePayload = {
    installation: { id: 42 },
    repository: { id: 101, full_name: "findmydoc-platform/management" },
    parent_issue: { id: 202, node_id: "I_parent", number: 17, updated_at: "2026-08-14T12:30:00Z" },
    parent_issue_repo: { id: 101, full_name: "findmydoc-platform/management" },
    sub_issue: { id: 203, node_id: "I_child", number: 18, updated_at: "2026-08-14T12:31:00Z" },
    sub_issue_repo: { id: 101, full_name: "findmydoc-platform/management" },
    sender: { id: 303, login: "founder", type: "User" },
  };
  for (const action of ["parent_issue_added", "parent_issue_removed", "sub_issue_added", "sub_issue_removed"]) {
    const result = inspect({ ...subIssuePayload, action }, { eventName: "sub_issues" });
    assert.equal(result.kind, "accepted");
    assert.equal(result.delivery.action, action);
  }
  assert.deepEqual(inspect({ ...subIssuePayload, action: "future_action" }, { eventName: "sub_issues" }), { kind: "ignored" });

  const dependencyPayload = {
    installation: { id: 42 },
    repository: { id: 101, full_name: "findmydoc-platform/management" },
    blocked_issue: { id: 202, node_id: "I_blocked", number: 17, updated_at: "2026-08-14T12:30:00Z" },
    blocking_issue: { id: 203, node_id: "I_blocking", number: 18, updated_at: "2026-08-14T12:31:00Z" },
    blocking_issue_repo: { id: 101, full_name: "findmydoc-platform/management" },
    sender: { id: 303, login: "founder", type: "User" },
  };
  for (const action of ["blocked_by_added", "blocked_by_removed", "blocking_added", "blocking_removed"]) {
    const result = inspect({ ...dependencyPayload, action }, { eventName: "issue_dependencies" });
    assert.equal(result.kind, "accepted");
    assert.equal(result.delivery.action, action);
  }
  assert.deepEqual(inspect({ ...dependencyPayload, action: "future_action" }, { eventName: "issue_dependencies" }), { kind: "ignored" });
});

test("Project item intake requires the configured stable organization identity", () => {
  const payload = {
    action: "created",
    organization: { id: 606, login: "findmydoc-platform" },
    projects_v2_item: {
      node_id: "PVTI_item",
      project_node_id: "PVT_project",
      content_node_id: "I_issue",
      content_type: "Issue",
      updated_at: "2026-08-14T12:31:00Z",
    },
    sender: { id: 303, login: "founder", type: "User" },
  };

  const unavailable = inspect(payload, { eventName: "projects_v2_item" }, { expectedOrganizationId: "" });
  assert.equal(unavailable.kind, "rejected");
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.code, "github_webhook_project_unavailable");

  const wrongOrganization = inspect({
    ...payload,
    organization: { id: 607, login: "external" },
  }, { eventName: "projects_v2_item" });
  assert.equal(wrongOrganization.kind, "rejected");
  assert.equal(wrongOrganization.status, 403);
  assert.equal(wrongOrganization.code, "github_webhook_wrong_organization");
});

test("relationship and Project mutations require causal timestamps", () => {
  const relationship = inspect({
    action: "blocked_by_added",
    installation: { id: 42 },
    repository: { id: 101, full_name: "findmydoc-platform/management" },
    blocked_issue: { id: 202, node_id: "I_blocked", number: 17, updated_at: "2026-08-14T12:30:00Z" },
    blocking_issue: { id: 203, node_id: "I_blocking", number: 18 },
    blocking_issue_repo: { id: 102, full_name: "findmydoc-platform/website" },
    sender: { id: 303, login: "founder", type: "User" },
  }, { eventName: "issue_dependencies" });
  assert.equal(relationship.kind, "rejected");
  assert.equal(relationship.code, "github_webhook_invalid_payload");

  const project = inspect({
    action: "edited",
    organization: { id: 606, login: "findmydoc-platform" },
    projects_v2_item: {
      node_id: "PVTI_item",
      project_node_id: "PVT_project",
      content_node_id: "I_issue",
      content_type: "Issue",
    },
    changes: { field_value: { field_node_id: "PVTF_status" } },
    sender: { id: 303, login: "founder", type: "User" },
  }, { eventName: "projects_v2_item" });
  assert.equal(project.kind, "rejected");
  assert.equal(project.code, "github_webhook_invalid_payload");
});

test("delivery persistence distinguishes new, replayed, conflicting, and unavailable receipts", async () => {
  const envelope = signedEnvelope(issuePayload());
  const base = {
    ...envelope,
    webhookSecret,
    expectedInstallationId,
    expectedOrganizationId,
  };

  const stored = await webhook.acceptGitHubIssueWebhook({
    ...base,
    store: { record: async () => "stored" },
  });
  assert.equal(stored.kind, "accepted");
  assert.equal(stored.duplicate, false);
  assert.equal(stored.delivery.deliveryId, "delivery-123");

  const duplicate = await webhook.acceptGitHubIssueWebhook({
    ...base,
    store: { record: async () => "duplicate" },
  });
  assert.equal(duplicate.kind, "accepted");
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.delivery.deliveryId, "delivery-123");

  const conflict = await webhook.acceptGitHubIssueWebhook({
    ...base,
    store: { record: async () => "conflict" },
  });
  assert.equal(conflict.kind, "rejected");
  assert.equal(conflict.status, 409);
  assert.equal(conflict.code, "github_webhook_delivery_conflict");

  const unavailable = await webhook.acceptGitHubIssueWebhook({
    ...base,
    store: { record: async () => { throw new Error("database unavailable"); } },
  });
  assert.equal(unavailable.kind, "rejected");
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.code, "github_webhook_storage_unavailable");
});

function supabaseFixture({ insertError = null, existing = null, expectedTable = "github_planning_webhook_deliveries" } = {}) {
  const state = {
    inserted: null,
    selectedColumns: null,
    selectedDeliveryId: null,
  };
  return {
    state,
    client: {
      from(table) {
        assert.equal(table, expectedTable);
        return {
          async insert(row) {
            state.inserted = row;
            return { error: insertError };
          },
          select(columns) {
            state.selectedColumns = columns;
            return {
              eq(column, value) {
                assert.equal(column, "delivery_id");
                state.selectedDeliveryId = value;
                return {
                  async maybeSingle() {
                    return existing || { data: null, error: null };
                  },
                };
              },
            };
          },
        };
      },
    },
  };
}

test("the Supabase store inserts normalized metadata and reconciles delivery-id races", async () => {
  const accepted = inspect(issuePayload());
  assert.equal(accepted.kind, "accepted");

  const newDelivery = supabaseFixture();
  const newStore = webhook.createSupabaseGitHubWebhookDeliveryStore(newDelivery.client);
  assert.equal(await newStore.record(accepted.delivery), "stored");
  assert.equal(newDelivery.state.inserted.delivery_id, "delivery-123");
  assert.equal(newDelivery.state.inserted.payload_sha256, accepted.delivery.payloadSha256);
  assert.equal(Object.hasOwn(newDelivery.state.inserted, "payload"), false);
  assert.equal(Object.hasOwn(newDelivery.state.inserted, "title"), false);
  assert.equal(Object.hasOwn(newDelivery.state.inserted, "body"), false);
  assert.equal(Object.hasOwn(newDelivery.state.inserted, "signature"), false);
  assert.equal(Object.hasOwn(newDelivery.state.inserted, "comment_id"), false);
  assert.equal(Object.hasOwn(newDelivery.state.inserted, "comment_node_id"), false);
  assert.equal(Object.hasOwn(newDelivery.state.inserted, "comment_updated_at"), false);

  const acceptedComment = inspect(commentPayload(), { eventName: "issue_comment" });
  assert.equal(acceptedComment.kind, "accepted");
  const commentDelivery = supabaseFixture({ expectedTable: "github_webhook_deliveries" });
  const commentStore = webhook.createSupabaseGitHubWebhookDeliveryStore(commentDelivery.client);
  assert.equal(await commentStore.record(acceptedComment.delivery), "stored");
  assert.equal(commentDelivery.state.inserted.comment_id, 404);
  assert.equal(commentDelivery.state.inserted.comment_node_id, "IC_kwDOExample");
  assert.equal(commentDelivery.state.inserted.comment_updated_at, "2026-08-14T12:31:00Z");
  assert.equal(Object.hasOwn(commentDelivery.state.inserted, "comment"), false);
  assert.equal(Object.hasOwn(commentDelivery.state.inserted, "comment_body"), false);

  const duplicateDelivery = supabaseFixture({
    insertError: { code: "23505" },
    existing: {
      data: {
        event_name: "issues",
        payload_sha256: accepted.delivery.payloadSha256,
      },
      error: null,
    },
  });
  const duplicateStore = webhook.createSupabaseGitHubWebhookDeliveryStore(duplicateDelivery.client);
  assert.equal(await duplicateStore.record(accepted.delivery), "duplicate");
  assert.equal(duplicateDelivery.state.selectedDeliveryId, "delivery-123");

  const conflictingDelivery = supabaseFixture({
    insertError: { code: "23505" },
    existing: {
      data: { event_name: "issues", payload_sha256: "0".repeat(64) },
      error: null,
    },
  });
  const conflictStore = webhook.createSupabaseGitHubWebhookDeliveryStore(conflictingDelivery.client);
  assert.equal(await conflictStore.record(accepted.delivery), "conflict");

  const failedDelivery = supabaseFixture({ insertError: { code: "08006" } });
  const failedStore = webhook.createSupabaseGitHubWebhookDeliveryStore(failedDelivery.client);
  await assert.rejects(() => failedStore.record(accepted.delivery), /could not be stored/);
});

test("the route rejects unsafe transport shapes and maps receipt outcomes", async () => {
  const issueDelivery = { eventName: "issues", deliveryId: "delivery-route" };
  const commentDelivery = { eventName: "issue_comment", deliveryId: "comment-delivery-route" };
  let intakeResult = { kind: "accepted", duplicate: false, delivery: issueDelivery };
  let intakeArguments = null;
  const afterCallbacks = [];
  const processedDeliveryIds = [];
  const supabase = { serviceRole: true };
  const store = { record: async () => "stored" };
  const projectionStore = { projection: true };
  const processedPlanningDeliveryIds = [];
  const route = await loadTranspiledModule("src/app/api/github/webhooks/route.ts", {
    "next/server": {
      after: (callback) => afterCallbacks.push(callback),
      NextResponse: {
        json: (body, init = {}) => ({
          body,
          status: init.status || 200,
          async json() { return body; },
        }),
      },
    },
    "@/lib/github-webhook-intake": {
      acceptGitHubIssueWebhook: async (args) => {
        intakeArguments = args;
        return intakeResult;
      },
      createSupabaseGitHubWebhookDeliveryStore: (client) => {
        assert.equal(client, supabase);
        return store;
      },
      githubWebhookMaxPayloadBytes: 1024,
    },
    "@/lib/github-issue-comment-webhook": {
      createSupabaseGitHubIssueCommentWebhookStore: (client) => {
        assert.equal(client, supabase);
        return projectionStore;
      },
      processGitHubIssueCommentWebhookDelivery: async ({ deliveryId, store: receivedStore }) => {
        assert.equal(receivedStore, projectionStore);
        processedDeliveryIds.push(deliveryId);
      },
    },
    "@/lib/github-planning-webhook": {
      processGitHubPlanningWebhookDelivery: async ({ deliveryId, supabase: receivedSupabase }) => {
        assert.equal(receivedSupabase, supabase);
        processedPlanningDeliveryIds.push(deliveryId);
      },
    },
    "@/lib/supabase-service-role": {
      getServerServiceRoleSupabase: () => supabase,
    },
  });

  const previousSecret = process.env.GITHUB_APP_WEBHOOK_SECRET;
  const previousInstallation = process.env.GITHUB_APP_INSTALLATION_ID;
  const previousOrganization = process.env.GITHUB_WEBHOOK_ORGANIZATION_ID;
  const request = (body = "{\"ok\":true}", headerOverrides = {}, options = {}) => {
    const rawBody = Buffer.from(body);
    const headers = new Headers({
      "content-type": "application/json",
      "content-length": String(rawBody.byteLength),
      "x-github-delivery": "delivery-route",
      "x-github-event": "issues",
      "x-hub-signature-256": "sha256=" + "a".repeat(64),
    });
    for (const [name, value] of Object.entries(headerOverrides)) {
      if (value === null) headers.delete(name);
      else headers.set(name, value);
    }

    const stream = options.streamError
      ? new ReadableStream({
          start(controller) {
            controller.error(new Error("stream failed"));
          },
        })
      : new ReadableStream({
          start(controller) {
            for (const chunk of options.chunks || [rawBody]) controller.enqueue(chunk);
            controller.close();
          },
        });

    return {
      headers,
      body: stream,
    };
  };

  try {
    delete process.env.GITHUB_APP_WEBHOOK_SECRET;
    delete process.env.GITHUB_APP_INSTALLATION_ID;
    let response = await route.POST(request());
    assert.equal(response.status, 503);
    assert.equal(response.body.code, "github_webhook_unavailable");

    process.env.GITHUB_APP_WEBHOOK_SECRET = webhookSecret;
    process.env.GITHUB_APP_INSTALLATION_ID = expectedInstallationId;
    process.env.GITHUB_WEBHOOK_ORGANIZATION_ID = expectedOrganizationId;

    response = await route.POST(request("{\"action\":\"edited\"}"));
    assert.equal(response.status, 202);
    assert.deepEqual(response.body, { ok: true, accepted: true });
    assert.equal(Buffer.from(intakeArguments.rawBody).toString("utf8"), "{\"action\":\"edited\"}");
    assert.equal(intakeArguments.store, store);
    assert.equal(intakeArguments.expectedOrganizationId, expectedOrganizationId);
    assert.equal(afterCallbacks.length, 1);
    await afterCallbacks.shift()();
    assert.deepEqual(processedPlanningDeliveryIds, ["delivery-route"]);

    intakeResult = { kind: "accepted", duplicate: true, delivery: commentDelivery };
    response = await route.POST(request());
    assert.equal(response.status, 200);
    assert.equal(response.body.duplicate, true);
    assert.equal(afterCallbacks.length, 1);
    await afterCallbacks.shift()();
    assert.deepEqual(processedDeliveryIds, ["comment-delivery-route"]);

    intakeResult = { kind: "ignored" };
    response = await route.POST(request());
    assert.equal(response.status, 204);

    intakeResult = {
      kind: "rejected",
      status: 401,
      code: "github_webhook_unauthorized",
      message: "GitHub webhook signature is invalid.",
    };
    response = await route.POST(request());
    assert.equal(response.status, 401);
    assert.equal(response.body.code, "github_webhook_unauthorized");

    response = await route.POST(request("{}", { "content-type": "text/plain" }));
    assert.equal(response.status, 415);

    response = await route.POST(request("{}", { "content-type": "text/application/json-evil" }));
    assert.equal(response.status, 415);

    response = await route.POST(request("{}", { "content-length": "1025" }));
    assert.equal(response.status, 413);

    response = await route.POST(request("x".repeat(1025), { "content-length": null }, {
      chunks: [Buffer.alloc(600), Buffer.alloc(425)],
    }));
    assert.equal(response.status, 413);
    assert.equal(response.body.code, "github_webhook_payload_too_large");

    response = await route.POST(request("{}", {}, { streamError: true }));
    assert.equal(response.status, 400);
    assert.equal(response.body.code, "github_webhook_invalid_payload");
  } finally {
    if (previousSecret === undefined) delete process.env.GITHUB_APP_WEBHOOK_SECRET;
    else process.env.GITHUB_APP_WEBHOOK_SECRET = previousSecret;
    if (previousInstallation === undefined) delete process.env.GITHUB_APP_INSTALLATION_ID;
    else process.env.GITHUB_APP_INSTALLATION_ID = previousInstallation;
    if (previousOrganization === undefined) delete process.env.GITHUB_WEBHOOK_ORGANIZATION_ID;
    else process.env.GITHUB_WEBHOOK_ORGANIZATION_ID = previousOrganization;
  }
});

test("the proxy bypasses Supabase auth only for the exact webhook path", async () => {
  let authFactoryCalls = 0;
  let getUserCalls = 0;
  const webhookResponse = { kind: "webhook-bypass" };
  const authenticatedResponse = { kind: "authenticated" };
  const proxyModule = await loadTranspiledModule("src/proxy.ts", {
    "next/server": {
      NextResponse: {
        next: () => webhookResponse,
      },
    },
    "@/lib/supabase-server": {
      createProxyAuthSupabase: () => {
        authFactoryCalls += 1;
        return {
          supabase: {
            auth: {
              getUser: async () => {
                getUserCalls += 1;
              },
            },
          },
          response: authenticatedResponse,
        };
      },
    },
  });

  assert.equal(
    await proxyModule.proxy({ nextUrl: { pathname: "/api/github/webhooks" } }),
    webhookResponse,
  );
  assert.equal(authFactoryCalls, 0);
  assert.equal(getUserCalls, 0);

  assert.equal(
    await proxyModule.proxy({ nextUrl: { pathname: "/api/github/webhooks/extra" } }),
    authenticatedResponse,
  );
  assert.equal(authFactoryCalls, 1);
  assert.equal(getUserCalls, 1);
});
