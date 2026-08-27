import assert from "node:assert/strict";

import { createHmac } from "node:crypto";

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
