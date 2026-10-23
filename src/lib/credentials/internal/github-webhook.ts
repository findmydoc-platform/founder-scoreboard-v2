import { observedSupabaseFetch } from "./observed-fetch";
import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { normalizeGitHubIssueWebhook, githubWebhookMaxPayloadBytes, type GitHubWebhookDeliveryStore } from "../../github-webhook-intake";
import { allowedGitHubRepositories } from "../../github-repositories";
import { createSupabaseGitHubIssueCommentWebhookStore, processGitHubIssueCommentWebhookDelivery } from "../../github-issue-comment-webhook";
import { processGitHubPlanningWebhookDelivery } from "../../github-planning-webhook";
import type { GitHubWebhookInput, GitHubWebhookResult } from "../github-webhook-types";
const signaturePattern = /^sha256=([0-9a-f]{64})$/i;
function configuration() {
  return { secret: process.env.GITHUB_APP_WEBHOOK_SECRET || "", installation: process.env.GITHUB_APP_INSTALLATION_ID?.trim() || "", organization: process.env.GITHUB_WEBHOOK_ORGANIZATION_ID?.trim() || "",
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "", key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "", repositories: [...allowedGitHubRepositories].sort().join("\n") };
}
function rejected(status: 400 | 401 | 403 | 409 | 413 | 415 | 503, code: string, message: string): GitHubWebhookResult { return { kind: "rejected", status, code, message }; }
const unavailable = () => rejected(503, "github_webhook_unavailable", "GitHub webhook intake is unavailable.");
function verifySignature(rawBody: Uint8Array, secret: string, signature: string | null) {
  const match = signature?.match(signaturePattern);
  if (!secret || !match)
    return false;
  const received = Buffer.from(match[1], "hex"), expected = createHmac("sha256", secret).update(rawBody).digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}
function contentLength(value: string | null) {
  if (value === null)
    return null;
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}
function isJsonContentType(value: string | null) {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}
type RawBodyReadResult = {
  ok: true;
  rawBody: Uint8Array;
} | {
  ok: false;
  reason: "too_large" | "unreadable";
};
async function readBoundedRawBody(request: NextRequest): Promise<RawBodyReadResult> {
  const reader = request.body?.getReader();
  if (!reader)
    return { ok: true, rawBody: new Uint8Array() };
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done)
        break;
      if (!value?.byteLength)
        continue;
      byteLength += value.byteLength;
      if (byteLength > githubWebhookMaxPayloadBytes) {
        await reader.cancel().catch(() => { });
        return { ok: false, reason: "too_large" };
      }
      chunks.push(new Uint8Array(value));
    }
  }
  catch {
    return { ok: false, reason: "unreadable" };
  }
  finally {
    reader.releaseLock();
  }
  // Keep the verification buffer bounded even when Content-Length is absent or false.
  const rawBody = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    rawBody.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, rawBody };
}
function createGitHubWebhookDeliveryStore(supabase: SupabaseClient): GitHubWebhookDeliveryStore {
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
      const { error } = await supabase.from(table).insert((delivery.eventName === "issue_comment" ? commentRow : planningRow) as never).retry(false);
      if (!error)
        return "stored";
      if (error.code !== "23505")
        throw new Error("GitHub webhook delivery could not be stored.");
      const existing = await supabase
        .from(table)
        .select("event_name,payload_sha256")
        .eq("delivery_id", delivery.deliveryId)
        .maybeSingle<{
        event_name: string;
        payload_sha256: string;
      }>().retry(false);
      if (existing.error || !existing.data)
        throw new Error("GitHub webhook delivery could not be reconciled.");
      return existing.data.event_name === delivery.eventName && existing.data.payload_sha256 === delivery.payloadSha256
        ? "duplicate"
        : "conflict";
    },
  };
}
export async function authorizeGitHubWebhook(input: GitHubWebhookInput): Promise<GitHubWebhookResult> {
  const request = input.credential.request;
  const config = configuration();
  const headers = { deliveryId: request.headers.get("x-github-delivery"), eventName: request.headers.get("x-github-event"), signature: request.headers.get("x-hub-signature-256") };
  const mediaType = request.headers.get("content-type"), length = request.headers.get("content-length");
  const current = () => { const actual = configuration(); return Object.keys(config).every(key => actual[key as keyof typeof actual] === config[key as keyof typeof config]); };
  if (!config.secret || !/^\d+$/.test(config.installation) || !config.url || !config.key)
    return unavailable();
  if (!isJsonContentType(mediaType))
    return rejected(415, "github_webhook_unsupported_media_type", "GitHub webhook payload must be JSON.");
  const declaredLength = contentLength(length);
  if (Number.isNaN(declaredLength))
    return rejected(400, "github_webhook_invalid_headers", "GitHub webhook headers are invalid.");
  if (declaredLength !== null && declaredLength > githubWebhookMaxPayloadBytes)
    return rejected(413, "github_webhook_payload_too_large", "GitHub webhook payload is too large.");
  const body = await readBoundedRawBody(request);
  if (!body.ok)
    return body.reason === "too_large" ? rejected(413, "github_webhook_payload_too_large", "GitHub webhook payload is too large.") : rejected(400, "github_webhook_invalid_payload", "GitHub webhook payload could not be read.");
  if (!current())
    return unavailable();
  const installation = Number(config.installation), organization = config.organization ? Number(config.organization) : null;
  if (!Number.isSafeInteger(installation) || installation <= 0 || (config.organization && (!Number.isSafeInteger(organization) || (organization || 0) <= 0)))
    return unavailable();
  if (!verifySignature(body.rawBody, config.secret, headers.signature))
    return rejected(401, "github_webhook_unauthorized", "GitHub webhook signature is invalid.");
  const inspection = normalizeGitHubIssueWebhook({ rawBody: body.rawBody, headers, expectedInstallationId: config.installation, expectedOrganizationId: config.organization });
  if (inspection.kind !== "accepted")
    return inspection;
  const delivery = structuredClone(inspection.delivery);
  let changed = false;
  const options = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  let receipt: SupabaseClient;
  try {
    receipt = createClient(config.url, config.key, { ...options, global: { fetch: async (input, init) => {
          if (!current()) {
            changed = true;
            return Response.json({ code: "github_webhook_unavailable", message: "GitHub webhook intake is unavailable." }, { status: 401 });
          }
          return observedSupabaseFetch(input, init);
        } } });
  }
  catch {
    return unavailable();
  }
  let recorded: "stored" | "duplicate" | "conflict";
  try {
    recorded = await createGitHubWebhookDeliveryStore(receipt).record(delivery);
  }
  catch {
    return changed ? unavailable() : rejected(503, "github_webhook_storage_unavailable", "GitHub webhook delivery could not be stored.");
  }
  if (recorded === "conflict")
    return rejected(409, "github_webhook_delivery_conflict", "GitHub webhook delivery identity conflicts with stored data.");
  // A persisted job has its own exact claim and lease. Later intake configuration changes do not revoke it.
  const processing = createClient(config.url, config.key, options);
  let dispatched: Promise<void> | undefined;
  const dispatch = async () => {
    if (delivery.eventName === "issue_comment")
      await processGitHubIssueCommentWebhookDelivery({ deliveryId: delivery.deliveryId, store: createSupabaseGitHubIssueCommentWebhookStore(processing) });
    else
      await processGitHubPlanningWebhookDelivery({ deliveryId: delivery.deliveryId, supabase: processing });
  };
  return { kind: "accepted", duplicate: recorded === "duplicate", delivery: structuredClone(delivery), dispatch: () => dispatched ??= dispatch() };
}
