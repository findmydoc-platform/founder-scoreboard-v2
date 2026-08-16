import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeGitHubRepository } from "./github-repositories";

export const githubWebhookMaxPayloadBytes = 2 * 1024 * 1024;

const deliveryIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const signaturePattern = /^sha256=([0-9a-f]{64})$/i;
const issueCommentActions = new Set(["created", "edited", "deleted"]);

type JsonObject = Record<string, unknown>;

export type GitHubWebhookHeaders = {
  deliveryId: string | null;
  eventName: string | null;
  signature: string | null;
};

export type GitHubWebhookDeliveryRecord = {
  deliveryId: string;
  eventName: "issues" | "issue_comment";
  action: string;
  installationId: number;
  repositoryId: number;
  repositoryFullName: string;
  issueId: number;
  issueNodeId: string;
  issueNumber: number;
  issueUpdatedAt: string;
  commentId: number | null;
  commentNodeId: string | null;
  commentUpdatedAt: string | null;
  senderId: number | null;
  senderLogin: string | null;
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
  | { kind: "accepted"; duplicate: boolean }
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
}: {
  rawBody: Uint8Array;
  headers: GitHubWebhookHeaders;
  webhookSecret: string;
  expectedInstallationId: string;
}): GitHubWebhookInspection {
  const expectedInstallation = Number(expectedInstallationId);
  if (!webhookSecret || !Number.isSafeInteger(expectedInstallation) || expectedInstallation <= 0) {
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

  if (eventName !== "ping" && eventName !== "issues" && eventName !== "issue_comment") {
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
  const repository = isJsonObject(payload.repository) ? payload.repository : null;
  const issue = isJsonObject(payload.issue) ? payload.issue : null;
  const comment = isJsonObject(payload.comment) ? payload.comment : null;
  const sender = isJsonObject(payload.sender) ? payload.sender : null;
  const installationId = positiveSafeInteger(installation?.id);
  const repositoryId = positiveSafeInteger(repository?.id);
  const repositoryFullName = boundedText(repository?.full_name, 255);
  const issueId = positiveSafeInteger(issue?.id);
  const issueNodeId = boundedText(issue?.node_id, 255);
  const issueNumber = positiveSafeInteger(issue?.number);
  const issueUpdatedAt = validTimestamp(issue?.updated_at);
  const senderId = positiveSafeInteger(sender?.id);
  const senderLogin = boundedText(sender?.login, 255);

  if (
    !action
    || !installationId
    || !repositoryId
    || !repositoryFullName
    || !issueId
    || !issueNodeId
    || !issueNumber
    || !issueUpdatedAt
  ) {
    return rejected(400, "github_webhook_invalid_payload", "GitHub Issue webhook payload is incomplete.");
  }
  if (installationId !== expectedInstallation) {
    return rejected(403, "github_webhook_wrong_installation", "GitHub webhook installation is not allowed.");
  }
  if (!normalizeGitHubRepository(repositoryFullName)) {
    return rejected(403, "github_webhook_wrong_repository", "GitHub webhook repository is not allowed.");
  }
  if (Object.prototype.hasOwnProperty.call(issue, "pull_request")) {
    if (eventName === "issue_comment") return { kind: "ignored" };
    return rejected(400, "github_webhook_not_issue", "GitHub webhook payload does not describe an Issue.");
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

  return {
    kind: "accepted",
    delivery: {
      deliveryId,
      eventName,
      action,
      installationId,
      repositoryId,
      repositoryFullName,
      issueId,
      issueNodeId,
      issueNumber,
      issueUpdatedAt,
      commentId,
      commentNodeId,
      commentUpdatedAt,
      senderId,
      senderLogin,
      payloadSha256: createHash("sha256").update(rawBody).digest("hex"),
    },
  };
}

export function createSupabaseGitHubWebhookDeliveryStore(supabase: SupabaseClient): GitHubWebhookDeliveryStore {
  return {
    async record(delivery) {
      const row = {
        delivery_id: delivery.deliveryId,
        event_name: delivery.eventName,
        action: delivery.action,
        installation_id: delivery.installationId,
        repository_id: delivery.repositoryId,
        repository_full_name: delivery.repositoryFullName,
        issue_id: delivery.issueId,
        issue_node_id: delivery.issueNodeId,
        issue_number: delivery.issueNumber,
        issue_updated_at: delivery.issueUpdatedAt,
        comment_id: delivery.commentId,
        comment_node_id: delivery.commentNodeId,
        comment_updated_at: delivery.commentUpdatedAt,
        sender_id: delivery.senderId,
        sender_login: delivery.senderLogin,
        payload_sha256: delivery.payloadSha256,
      };
      const { error } = await supabase.from("github_webhook_deliveries").insert(row);
      if (!error) return "stored";
      if (error.code !== "23505") throw new Error("GitHub webhook delivery could not be stored.");

      const existing = await supabase
        .from("github_webhook_deliveries")
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
  store,
}: {
  rawBody: Uint8Array;
  headers: GitHubWebhookHeaders;
  webhookSecret: string;
  expectedInstallationId: string;
  store: GitHubWebhookDeliveryStore;
}): Promise<GitHubWebhookIntakeResult> {
  const inspection = inspectGitHubIssueWebhook({
    rawBody,
    headers,
    webhookSecret,
    expectedInstallationId,
  });
  if (inspection.kind !== "accepted") return inspection;

  try {
    const recorded = await store.record(inspection.delivery);
    if (recorded === "conflict") {
      return rejected(409, "github_webhook_delivery_conflict", "GitHub webhook delivery identity conflicts with stored data.");
    }
    return { kind: "accepted", duplicate: recorded === "duplicate" };
  } catch {
    return rejected(503, "github_webhook_storage_unavailable", "GitHub webhook delivery could not be stored.");
  }
}
