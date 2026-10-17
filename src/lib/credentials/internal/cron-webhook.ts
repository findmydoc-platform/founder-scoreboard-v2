import "server-only";
import { projectionAccounting } from "./projection-accounting";
import { reassertDeliveryAdmission, runWithDeliveryAdmission } from "./delivery-admission-scope";
import { timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { drainGitHubWebhookDeliveries, type GitHubWebhookDrainResult } from "../../github-webhook-drain";
import type { CronWebhookHealth, CronWebhookInput, CronWebhookResult } from "../cron-types";

function configuration() {
  return {
    secret: process.env.CRON_SECRET?.trim() || "",
    url: process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || "",
    key: process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || "",
  };
}
function matches(provided: string, expected: string) {
  const left = Buffer.from(provided), right = Buffer.from(expected);
  return Boolean(left.length && left.length === right.length && timingSafeEqual(left, right));
}
async function health(supabase: SupabaseClient): Promise<CronWebhookHealth> {
  const [planning, comments, projection, archivedPlanning, archivedComments, planningOutstanding, commentOutstanding, projectionOutstanding] = await Promise.all([
    supabase.from("github_planning_webhook_deliveries").select("status_reason").eq("status", "failed").is("archived_at", null),
    supabase.from("github_webhook_deliveries").select("status_reason").eq("event_name", "issue_comment").eq("status", "failed").is("archived_at", null),
    supabase.from("planning_github_projection_outbox").select("status_reason").eq("source_kind", "github_webhook").eq("status", "failed"),
    supabase.from("github_planning_webhook_deliveries").select("archive_reason").eq("status", "failed").not("archived_at", "is", null),
    supabase.from("github_webhook_deliveries").select("archive_reason").eq("event_name", "issue_comment").eq("status", "failed").not("archived_at", "is", null),
    supabase.from("github_planning_webhook_deliveries").select("delivery_id", { count: "exact", head: true }).in("status", ["received", "processing", "retry_scheduled"]),
    supabase.from("github_webhook_deliveries").select("delivery_id", { count: "exact", head: true }).eq("event_name", "issue_comment").in("status", ["received", "processing", "retry_scheduled"]),
    supabase.from("planning_github_projection_outbox").select("id", { count: "exact", head: true }).eq("source_kind", "github_webhook").in("status", ["pending", "processing", "retry_scheduled"]),
  ]);
  const results = [planning, comments, projection, archivedPlanning, archivedComments, planningOutstanding, commentOutstanding, projectionOutstanding];
  if (results.some(result => result.error) || [planningOutstanding, commentOutstanding, projectionOutstanding].some(result => !Number.isSafeInteger(result.count) || Number(result.count) < 0)) {
    throw new Error("GitHub webhook queue state could not be loaded.");
  }
  return {
    unresolved: {
      planning: (planning.data || []).map(row => row.status_reason),
      comments: (comments.data || []).map(row => row.status_reason),
      projection: (projection.data || []).map(row => row.status_reason),
    },
    archived: {
      planning: (archivedPlanning.data || []).map(row => row.archive_reason),
      comments: (archivedComments.data || []).map(row => row.archive_reason),
      projection: [],
    },
    outstanding: { planning: Number(planningOutstanding.count), comments: Number(commentOutstanding.count), projection: Number(projectionOutstanding.count) },
  };
}

export async function authorizeCronWebhook(input: CronWebhookInput): Promise<CronWebhookResult> {
  const config = configuration();
  const header = input.credential.request.headers.get("authorization") || "";
  const candidate = /^\s*Bearer\s+(.+?)\s*$/i.exec(header)?.[1] || "";
  if (!config.secret) return { ok: false, status: 503, error: "GitHub-Webhook-Cron ist nicht konfiguriert." };
  if (!matches(candidate, config.secret)) return { ok: false, status: 401, error: "Ungültiger Cron-Secret." };
  const assertDatabaseBinding = () => {
    const current = configuration();
    if (current.url !== config.url || current.key !== config.key) throw new Error("Cron storage binding is no longer valid.");
  };
  const assertCurrent = () => {
    assertDatabaseBinding();
    if (configuration().secret !== config.secret) throw new Error("Cron admission is no longer valid.");
  };
  if (!config.url || !config.key) return { ok: false, status: 501, error: "Supabase env is not configured." };
  const accounting = projectionAccounting();
  const confirmedCommentClaims = new Map<string, number>();
  const confirmedPlanningClaims = new Map<string, number>();
  const confirmedProjectionClaims = new Map<string, number>();
  const claimIdentity = (id: unknown, lock: unknown) => JSON.stringify([id, lock]);
  let data: SupabaseClient;
  try {
    data = createClient(config.url, config.key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async (input, init) => {
        const path = new URL(input instanceof Request ? input.url : String(input)).pathname.split("/").at(-1);
        const body = typeof init?.body === "string" ? JSON.parse(init.body) as Record<string, unknown> : {};
        const identity = claimIdentity(body.p_delivery_id ?? body.p_request_id, body.p_lock_token);
        const claimBound = path === "finalize_github_issue_comment_webhook_delivery" || path === "apply_github_issue_comment_webhook_projection_with_mentions"
          ? confirmedCommentClaims
          : path === "finalize_github_planning_webhook_delivery" || path === "enqueue_github_webhook_planning_projection"
            ? confirmedPlanningClaims
            : path === "finalize_planning_github_projection_request" ? confirmedProjectionClaims : undefined;
        if (claimBound && !claimBound.has(identity)) return Response.json({ message: "Cron claim ownership is not valid." }, { status: 401 });
        if (!claimBound && !accounting.accepts(path || "", body)) {
          try {
            const assertAdmission = await reassertDeliveryAdmission();
            assertCurrent();
            assertAdmission();
          } catch { return Response.json({ message: "Cron admission is no longer valid." }, { status: 401 }); }
        }
        try { assertDatabaseBinding(); } catch { return Response.json({ message: "Cron storage binding is no longer valid." }, { status: 401 }); }
        const claimStartedAt = Date.now();
        const response = await fetch(input, init);
        if (response.ok && (path === "claim_github_issue_comment_webhook_delivery" || path === "claim_github_planning_webhook_delivery")) {
          const value = await response.clone().json();
          const claimed = Array.isArray(value) ? value[0] : value;
          if (claimed?.delivery_id === body.p_delivery_id && typeof body.p_lock_token === "string") {
            const claims = path === "claim_github_issue_comment_webhook_delivery" ? confirmedCommentClaims : confirmedPlanningClaims;
            const identity = claimIdentity(body.p_delivery_id, body.p_lock_token);
            if (!claims.has(identity)) claims.set(identity, claimStartedAt + 120_000);
          }
        }
        if (response.ok && path === "claim_planning_github_projection_requests") {
          const value = await response.clone().json();
          if (Array.isArray(value) && typeof body.p_lock_token === "string") {
            for (const claimed of value) if (typeof claimed?.id === "string") {
              const identity = claimIdentity(claimed.id, body.p_lock_token);
              if (!confirmedProjectionClaims.has(identity)) confirmedProjectionClaims.set(identity, claimStartedAt + 120_000);
            }
          }
        }
        if (response.ok && path) {
          if (["try_acquire_github_issue_sync_lock", "begin_github_issue_sync_transaction_v2", "finalize_github_issue_sync_with_pull_requests_v1", "release_github_issue_sync_lock"].includes(path)) accounting.observe(path, body, await response.clone().json());
          if (claimBound && path.startsWith("finalize_")) claimBound.delete(identity);
        }
        return response;
      } },
    });
  } catch { return { ok: false, status: 501, error: "Supabase env is not configured." }; }
  let operation: Promise<GitHubWebhookDrainResult> | undefined;
  return { ok: true, webhookDrain: Object.freeze({
    run() {
      assertCurrent();
      return operation ??= runWithDeliveryAdmission(async (claim) => {
        const assertTrigger = () => {
          assertCurrent();
          if (claim === null) throw new Error("A claimed GitHub job is required for Cron resource dispatch.");
          if (claim !== undefined) {
            const claims = claim.family === "comment-webhook" ? confirmedCommentClaims : claim.family === "planning-webhook" ? confirmedPlanningClaims : claim.family === "planning-projection" ? confirmedProjectionClaims : undefined;
            const deadline = claims?.get(claimIdentity(claim.id, claim.lockToken));
            if (!deadline || Date.now() >= deadline) throw new Error("Cron job claim is no longer valid.");
          }
        };
        assertTrigger();
        return assertTrigger;
      }, () => drainGitHubWebhookDeliveries({ supabase: data, limit: 25 }));
    },
    health() { assertCurrent(); return health(data); },
  }) };
}
