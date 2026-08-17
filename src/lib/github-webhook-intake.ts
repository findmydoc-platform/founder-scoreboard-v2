import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeGitHubRepository } from "./github-repositories";

export const githubWebhookMaxPayloadBytes = 2 * 1024 * 1024;

const deliveryIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const signaturePattern = /^sha256=([0-9a-f]{64})$/i;
const issueCommentActions = new Set(["created", "edited", "deleted"]);
const planningEventNames = new Set(["issues", "sub_issues", "issue_dependencies", "projects_v2_item"]);
const issuePlanningActions = new Set([
  "assigned",
  "closed",
  "demilestoned",
  "edited",
  "field_added",
  "field_removed",
  "labeled",
  "milestoned",
  "reopened",
  "unassigned",
  "unlabeled",
]);
const subIssueActions = new Set([
  "parent_issue_added",
  "parent_issue_removed",
  "sub_issue_added",
  "sub_issue_removed",
]);
const issueDependencyActions = new Set([
  "blocked_by_added",
  "blocked_by_removed",
  "blocking_added",
  "blocking_removed",
]);
const projectItemActions = new Set(["archived", "converted", "created", "deleted", "edited", "reordered", "restored"]);

type JsonObject = Record<string, unknown>;

export type GitHubWebhookHeaders = {
  deliveryId: string | null;
  eventName: string | null;
  signature: string | null;
};

export type GitHubWebhookDeliveryRecord = {
  deliveryId: string;
  eventName: "issues" | "issue_comment" | "sub_issues" | "issue_dependencies" | "projects_v2_item";
  action: string;
  installationId: number | null;
  organizationId: number | null;
  organizationLogin: string | null;
  repositoryId: number | null;
  repositoryFullName: string | null;
  issueId: number | null;
  issueNodeId: string | null;
  issueNumber: number | null;
  issueUpdatedAt: string | null;
  relatedRepositoryId: number | null;
  relatedRepositoryFullName: string | null;
  relatedIssueId: number | null;
  relatedIssueNodeId: string | null;
  relatedIssueNumber: number | null;
  relatedIssueUpdatedAt: string | null;
  projectNodeId: string | null;
  projectItemNodeId: string | null;
  projectItemUpdatedAt: string | null;
  projectContentNodeId: string | null;
  projectContentType: "Issue" | null;
  projectFieldNodeId: string | null;
  changedFields: string[];
  targetUserId: number | null;
  targetUserLogin: string | null;
  commentId: number | null;
  commentNodeId: string | null;
  commentUpdatedAt: string | null;
  senderId: number | null;
  senderLogin: string | null;
  senderType: string | null;
  payloadSha256: string;
};

export type GitHubWebhookDeliveryRecordResult = "stored" | "duplicate" | "conflict";

export type GitHubWebhookDeliveryStore = {
  record(delivery: GitHubWebhookDeliveryRecord): Promise<GitHubWebhookDeliveryRecordResult>;
};

export type GitHubWebhookInspection =
  | { kind: "accepted"; delivery: GitHubWebhookDeliveryRecord }
  | { kind: "ping" }
  | { kind: "ignored" }
  | { kind: "rejected"; status: 400 | 401 | 403 | 409 | 503; code: string; message: string };

export type GitHubWebhookIntakeResult =
  | { kind: "accepted"; duplicate: boolean; delivery: GitHubWebhookDeliveryRecord }
  | Exclude<GitHubWebhookInspection, { kind: "accepted" }>;

function rejected(
  status: 400 | 401 | 403 | 409 | 503,
  code: string,
  message: string,
): Extract<GitHubWebhookInspection, { kind: "rejected" }> {
  return { kind: "rejected", status, code, message };
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function positiveSafeInteger(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function boundedText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

function validTimestamp(value: unknown) {
  const timestamp = boundedText(value, 64);
  return timestamp && !Number.isNaN(Date.parse(timestamp)) ? timestamp : null;
}

function changedFieldNames(value: unknown) {
  if (!isJsonObject(value)) return [];
  return Object.keys(value)
    .map((field) => field.trim())
    .filter((field) => Boolean(field) && field.length <= 120)
    .slice(0, 20);
}

type NormalizedRepository = { id: number; fullName: string };
type NormalizedIssue = { id: number; nodeId: string; number: number; updatedAt: string | null };

function normalizedRepository(value: unknown): NormalizedRepository | null {
  const repository = isJsonObject(value) ? value : null;
  const id = positiveSafeInteger(repository?.id);
  const fullName = boundedText(repository?.full_name, 255);
  return id && fullName ? { id, fullName } : null;
}

function normalizedIssue(value: unknown, requireTimestamp = false): NormalizedIssue | null {
  const issue = isJsonObject(value) ? value : null;
  const id = positiveSafeInteger(issue?.id);
  const nodeId = boundedText(issue?.node_id, 255);
  const number = positiveSafeInteger(issue?.number);
  const updatedAt = validTimestamp(issue?.updated_at);
  if (!id || !nodeId || !number || (requireTimestamp && !updatedAt)) return null;
  return { id, nodeId, number, updatedAt };
}

function allowedRepository(repository: NormalizedRepository | null) {
  return Boolean(repository && normalizeGitHubRepository(repository.fullName));
}

function planningChangedFields(payload: JsonObject, eventName: string, action: string) {
  const changes = changedFieldNames(payload.changes);
  if (eventName === "issues") {
    if (action === "labeled" || action === "unlabeled") {
      const label = isJsonObject(payload.label) ? boundedText(payload.label.name, 120)?.toLowerCase() : null;
      return label ? [`label:${label}`] : [];
    }
    if (action === "assigned" || action === "unassigned") return ["assignee"];
    if (action === "closed" || action === "reopened") return ["state"];
    if (action === "field_added" || action === "field_removed") {
      const field = isJsonObject(payload.field) ? boundedText(payload.field.name, 120) : null;
      return field ? [`issue_field:${field}`] : [];
    }
  }
  if (eventName === "sub_issues") return ["parentTaskId"];
  if (eventName === "issue_dependencies") return ["blockedBy"];
  return changes;
}

export function verifyGitHubWebhookSignature(rawBody: Uint8Array, secret: string, signature: string | null) {
  if (!secret || !signature) return false;
  const match = signature.match(signaturePattern);
  if (!match) return false;

  const received = Buffer.from(match[1], "hex");
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function inspectGitHubIssueWebhook({
  rawBody,
  headers,
  webhookSecret,
  expectedInstallationId,
  expectedOrganizationId = "",
}: {
  rawBody: Uint8Array;
  headers: GitHubWebhookHeaders;
  webhookSecret: string;
  expectedInstallationId: string;
  expectedOrganizationId?: string;
}): GitHubWebhookInspection {
  const expectedInstallation = Number(expectedInstallationId);
  const expectedOrganization = expectedOrganizationId ? Number(expectedOrganizationId) : null;
  if (
    !webhookSecret
    || !Number.isSafeInteger(expectedInstallation)
    || expectedInstallation <= 0
    || (expectedOrganizationId && (!Number.isSafeInteger(expectedOrganization) || (expectedOrganization || 0) <= 0))
  ) {
    return rejected(503, "github_webhook_unavailable", "GitHub webhook intake is unavailable.");
  }
  if (!verifyGitHubWebhookSignature(rawBody, webhookSecret, headers.signature)) {
    return rejected(401, "github_webhook_unauthorized", "GitHub webhook signature is invalid.");
  }

  const deliveryId = boundedText(headers.deliveryId, 128);
  const eventName = boundedText(headers.eventName, 64)?.toLowerCase() || null;
  if (!deliveryId || !deliveryIdPattern.test(deliveryId) || !eventName) {
    return rejected(400, "github_webhook_invalid_headers", "GitHub webhook headers are invalid.");
  }

  if (eventName !== "ping" && eventName !== "issue_comment" && !planningEventNames.has(eventName)) {
    return { kind: "ignored" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(rawBody).toString("utf8"));
  } catch {
    return rejected(400, "github_webhook_invalid_payload", "GitHub webhook payload is invalid.");
  }
  if (!isJsonObject(payload)) {
    return rejected(400, "github_webhook_invalid_payload", "GitHub webhook payload is invalid.");
  }
  if (eventName === "ping") return { kind: "ping" };

  const action = boundedText(payload.action, 64);
  const installation = isJsonObject(payload.installation) ? payload.installation : null;
  const organization = isJsonObject(payload.organization) ? payload.organization : null;
  const repository = normalizedRepository(payload.repository);
  const issueObject = isJsonObject(payload.issue) ? payload.issue : null;
  const issue = normalizedIssue(issueObject, true);
  const comment = isJsonObject(payload.comment) ? payload.comment : null;
  const sender = isJsonObject(payload.sender) ? payload.sender : null;
  const installationId = positiveSafeInteger(installation?.id);
  const organizationId = positiveSafeInteger(organization?.id);
  const organizationLogin = boundedText(organization?.login, 255);
  const senderId = positiveSafeInteger(sender?.id);
  const senderLogin = boundedText(sender?.login, 255);
  const senderType = boundedText(sender?.type, 64);

  if (!action) return rejected(400, "github_webhook_invalid_payload", "GitHub webhook payload is incomplete.");
  if (eventName === "projects_v2_item") {
    if (!expectedOrganization) {
      return rejected(503, "github_webhook_project_unavailable", "GitHub Project webhook intake is unavailable.");
    }
    if (!organizationId || !organizationLogin) {
      return rejected(400, "github_webhook_invalid_payload", "GitHub Project webhook organization is incomplete.");
    }
    if (organizationId !== expectedOrganization) {
      return rejected(403, "github_webhook_wrong_organization", "GitHub webhook organization is not allowed.");
    }
    if (installationId && installationId !== expectedInstallation) {
      return rejected(403, "github_webhook_wrong_installation", "GitHub webhook installation is not allowed.");
    }
  } else {
    if (!installationId) return rejected(400, "github_webhook_invalid_payload", "GitHub webhook installation is incomplete.");
    if (installationId !== expectedInstallation) {
      return rejected(403, "github_webhook_wrong_installation", "GitHub webhook installation is not allowed.");
    }
  }

  let primaryRepository = repository;
  let primaryIssue = issue;
  let relatedRepository: NormalizedRepository | null = null;
  let relatedIssue: NormalizedIssue | null = null;
  let projectNodeId: string | null = null;
  let projectItemNodeId: string | null = null;
  let projectItemUpdatedAt: string | null = null;
  let projectContentNodeId: string | null = null;
  let projectContentType: "Issue" | null = null;
  let projectFieldNodeId: string | null = null;

  if (eventName === "issues" || eventName === "issue_comment") {
    if (!primaryRepository || !primaryIssue) {
      return rejected(400, "github_webhook_invalid_payload", "GitHub Issue webhook payload is incomplete.");
    }
    if (!allowedRepository(primaryRepository)) {
      return rejected(403, "github_webhook_wrong_repository", "GitHub webhook repository is not allowed.");
    }
    if (Object.prototype.hasOwnProperty.call(issueObject || {}, "pull_request")) {
      if (eventName === "issue_comment") return { kind: "ignored" };
      return rejected(400, "github_webhook_not_issue", "GitHub webhook payload does not describe an Issue.");
    }
    if (eventName === "issues" && !issuePlanningActions.has(action)) return { kind: "ignored" };
  } else if (eventName === "sub_issues") {
    if (!subIssueActions.has(action)) return { kind: "ignored" };
    primaryRepository = normalizedRepository(payload.parent_issue_repo) || repository;
    primaryIssue = normalizedIssue(payload.parent_issue, true) || normalizedIssue(payload.issue, true);
    relatedRepository = normalizedRepository(payload.sub_issue_repo)
      || normalizedRepository(isJsonObject(payload.sub_issue) ? payload.sub_issue.repository : null)
      || repository;
    relatedIssue = normalizedIssue(payload.sub_issue, true);
  } else if (eventName === "issue_dependencies") {
    if (!issueDependencyActions.has(action)) return { kind: "ignored" };
    primaryRepository = normalizedRepository(payload.blocked_issue_repo) || repository;
    primaryIssue = normalizedIssue(payload.blocked_issue, true);
    relatedRepository = normalizedRepository(payload.blocking_issue_repo)
      || normalizedRepository(isJsonObject(payload.blocking_issue) ? payload.blocking_issue.repository : null)
      || repository;
    relatedIssue = normalizedIssue(payload.blocking_issue, true);
  } else {
    const projectItem = isJsonObject(payload.projects_v2_item) ? payload.projects_v2_item : null;
    if (!projectItemActions.has(action) || projectItem?.content_type !== "Issue") return { kind: "ignored" };
    const project = isJsonObject(payload.project) ? payload.project : null;
    projectItemNodeId = boundedText(projectItem?.node_id, 255)
      || boundedText(projectItem?.id, 255);
    projectItemUpdatedAt = validTimestamp(projectItem?.updated_at);
    projectNodeId = boundedText(projectItem?.project_node_id, 255)
      || boundedText(project?.node_id, 255)
      || boundedText(project?.id, 255);
    projectContentNodeId = boundedText(projectItem?.content_node_id, 255);
    projectContentType = projectItem?.content_type === "Issue" ? "Issue" : null;
    const changes = isJsonObject(payload.changes) ? payload.changes : null;
    const fieldValueChange = isJsonObject(changes?.field_value) ? changes.field_value : null;
    projectFieldNodeId = action === "edited" ? boundedText(fieldValueChange?.field_node_id, 255) : null;
    primaryRepository = null;
    primaryIssue = null;
  }

  if (eventName === "sub_issues" || eventName === "issue_dependencies") {
    if (!primaryRepository || !primaryIssue || !relatedRepository || !relatedIssue) {
      return rejected(400, "github_webhook_invalid_payload", "GitHub relationship webhook payload is incomplete.");
    }
    if (!allowedRepository(primaryRepository) || !allowedRepository(relatedRepository)) {
      return rejected(403, "github_webhook_wrong_repository", "GitHub webhook repository is not allowed.");
    }
  }
  if (eventName === "projects_v2_item" && (
    !projectNodeId
    || !projectItemNodeId
    || !projectItemUpdatedAt
    || !projectContentNodeId
    || !projectContentType
    || (action === "edited" && !projectFieldNodeId)
  )) {
    return rejected(400, "github_webhook_invalid_payload", "GitHub Project webhook payload is incomplete.");
  }

  let commentId: number | null = null;
  let commentNodeId: string | null = null;
  let commentUpdatedAt: string | null = null;
  if (eventName === "issue_comment") {
    if (!issueCommentActions.has(action)) return { kind: "ignored" };
    commentId = positiveSafeInteger(comment?.id);
    commentNodeId = boundedText(comment?.node_id, 255);
    commentUpdatedAt = validTimestamp(comment?.updated_at);
    if (!commentId || !commentNodeId || !commentUpdatedAt) {
      return rejected(400, "github_webhook_invalid_payload", "GitHub Issue comment webhook payload is incomplete.");
    }
  }

  const assignee = isJsonObject(payload.assignee) ? payload.assignee : null;
  const targetUserId = eventName === "issues" && (action === "assigned" || action === "unassigned")
    ? positiveSafeInteger(assignee?.id)
    : null;
  const targetUserLogin = eventName === "issues" && (action === "assigned" || action === "unassigned")
    ? boundedText(assignee?.login, 255)
    : null;

  return {
    kind: "accepted",
    delivery: {
      deliveryId,
      eventName: eventName as GitHubWebhookDeliveryRecord["eventName"],
      action,
      installationId,
      organizationId,
      organizationLogin,
      repositoryId: primaryRepository?.id || null,
      repositoryFullName: primaryRepository?.fullName || null,
      issueId: primaryIssue?.id || null,
      issueNodeId: primaryIssue?.nodeId || null,
      issueNumber: primaryIssue?.number || null,
      issueUpdatedAt: primaryIssue?.updatedAt || null,
      relatedRepositoryId: relatedRepository?.id || null,
      relatedRepositoryFullName: relatedRepository?.fullName || null,
      relatedIssueId: relatedIssue?.id || null,
      relatedIssueNodeId: relatedIssue?.nodeId || null,
      relatedIssueNumber: relatedIssue?.number || null,
      relatedIssueUpdatedAt: relatedIssue?.updatedAt || null,
      projectNodeId,
      projectItemNodeId,
      projectItemUpdatedAt,
      projectContentNodeId,
      projectContentType,
      projectFieldNodeId,
      changedFields: planningChangedFields(payload, eventName, action),
      targetUserId,
      targetUserLogin,
      commentId,
      commentNodeId,
      commentUpdatedAt,
      senderId,
      senderLogin,
      senderType,
      payloadSha256: createHash("sha256").update(rawBody).digest("hex"),
    },
  };
}

export function createSupabaseGitHubWebhookDeliveryStore(supabase: SupabaseClient): GitHubWebhookDeliveryStore {
  return {
    async record(delivery) {
      const commonRow = {
        delivery_id: delivery.deliveryId,
        event_name: delivery.eventName,
        action: delivery.action,
        installation_id: delivery.installationId,
        organization_id: delivery.organizationId,
        organization_login: delivery.organizationLogin,
        repository_id: delivery.repositoryId,
        repository_full_name: delivery.repositoryFullName,
        issue_id: delivery.issueId,
        issue_node_id: delivery.issueNodeId,
        issue_number: delivery.issueNumber,
        issue_updated_at: delivery.issueUpdatedAt,
        sender_id: delivery.senderId,
        sender_login: delivery.senderLogin,
        sender_type: delivery.senderType,
        payload_sha256: delivery.payloadSha256,
      };
      const planningRow = {
        ...commonRow,
        related_repository_id: delivery.relatedRepositoryId,
        related_repository_full_name: delivery.relatedRepositoryFullName,
        related_issue_id: delivery.relatedIssueId,
        related_issue_node_id: delivery.relatedIssueNodeId,
        related_issue_number: delivery.relatedIssueNumber,
        related_issue_updated_at: delivery.relatedIssueUpdatedAt,
        project_node_id: delivery.projectNodeId,
        project_item_node_id: delivery.projectItemNodeId,
        project_item_updated_at: delivery.projectItemUpdatedAt,
        project_content_node_id: delivery.projectContentNodeId,
        project_content_type: delivery.projectContentType,
        project_field_node_id: delivery.projectFieldNodeId,
        changed_fields: delivery.changedFields,
        target_user_id: delivery.targetUserId,
        target_user_login: delivery.targetUserLogin,
      };
      const commentRow = {
        delivery_id: commonRow.delivery_id,
        event_name: "issue_comment",
        action: commonRow.action,
        installation_id: commonRow.installation_id,
        repository_id: commonRow.repository_id,
        repository_full_name: commonRow.repository_full_name,
        issue_id: commonRow.issue_id,
        issue_node_id: commonRow.issue_node_id,
        issue_number: commonRow.issue_number,
        issue_updated_at: commonRow.issue_updated_at,
        comment_id: delivery.commentId,
        comment_node_id: delivery.commentNodeId,
        comment_updated_at: delivery.commentUpdatedAt,
        sender_id: commonRow.sender_id,
        sender_login: commonRow.sender_login,
        payload_sha256: commonRow.payload_sha256,
      };
      const table = delivery.eventName === "issue_comment"
        ? "github_webhook_deliveries"
        : "github_planning_webhook_deliveries";
      const { error } = await supabase.from(table).insert(
        (delivery.eventName === "issue_comment" ? commentRow : planningRow) as never,
      );
      if (!error) return "stored";
      if (error.code !== "23505") throw new Error("GitHub webhook delivery could not be stored.");

      const existing = await supabase
        .from(table)
        .select("event_name,payload_sha256")
        .eq("delivery_id", delivery.deliveryId)
        .maybeSingle<{ event_name: string; payload_sha256: string }>();
      if (existing.error || !existing.data) throw new Error("GitHub webhook delivery could not be reconciled.");
      return existing.data.event_name === delivery.eventName && existing.data.payload_sha256 === delivery.payloadSha256
        ? "duplicate"
        : "conflict";
    },
  };
}

export async function acceptGitHubIssueWebhook({
  rawBody,
  headers,
  webhookSecret,
  expectedInstallationId,
  expectedOrganizationId = "",
  store,
}: {
  rawBody: Uint8Array;
  headers: GitHubWebhookHeaders;
  webhookSecret: string;
  expectedInstallationId: string;
  expectedOrganizationId?: string;
  store: GitHubWebhookDeliveryStore;
}): Promise<GitHubWebhookIntakeResult> {
  const inspection = inspectGitHubIssueWebhook({
    rawBody,
    headers,
    webhookSecret,
    expectedInstallationId,
    expectedOrganizationId,
  });
  if (inspection.kind !== "accepted") return inspection;

  try {
    const recorded = await store.record(inspection.delivery);
    if (recorded === "conflict") {
      return rejected(409, "github_webhook_delivery_conflict", "GitHub webhook delivery identity conflicts with stored data.");
    }
    return {
      kind: "accepted",
      duplicate: recorded === "duplicate",
      delivery: inspection.delivery,
    };
  } catch {
    return rejected(503, "github_webhook_storage_unavailable", "GitHub webhook delivery could not be stored.");
  }
}
