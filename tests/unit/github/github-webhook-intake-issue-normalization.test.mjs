import assert from "node:assert/strict";

import { createHash, createHmac } from "node:crypto";

import { test } from "vitest";

import { importTestModule } from "../../helpers/vitest-module.mjs";

const webhookSecret = "test-webhook-secret";

const expectedInstallationId = "42";

const expectedOrganizationId = "606";

const allowedRepositories = new Set([
  "findmydoc-platform/management",
  "findmydoc-platform/website",
  "findmydoc-platform/clinic-dashboard",
]);

const webhook = await importTestModule("src/lib/github-webhook-intake.ts", {
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
