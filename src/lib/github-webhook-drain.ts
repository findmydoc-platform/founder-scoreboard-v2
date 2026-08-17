import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { dispatchPlanningGitHubProjections } from "@/features/planning-items/model/planning-items-github-projection";
import {
  createSupabaseGitHubIssueCommentWebhookStore,
  processGitHubIssueCommentWebhookDelivery,
  type GitHubIssueCommentWebhookResult,
} from "./github-issue-comment-webhook";
import { processGitHubPlanningWebhookDelivery, type GitHubPlanningWebhookResult } from "./github-planning-webhook";

type DeliveryCounters = {
  claimed: number;
  processed: number;
  ignored: number;
  retryScheduled: number;
  failed: number;
  skipped: number;
};

export type GitHubWebhookDrainResult = Readonly<{
  projection: Readonly<{
    claimed: number;
    completed: number;
    retryScheduled: number;
    failed: number;
  }>;
  planning: Readonly<DeliveryCounters>;
  comments: Readonly<DeliveryCounters>;
}>;

function emptyCounters(): DeliveryCounters {
  return { claimed: 0, processed: 0, ignored: 0, retryScheduled: 0, failed: 0, skipped: 0 };
}

function recordResult(
  counters: DeliveryCounters,
  result: GitHubPlanningWebhookResult | GitHubIssueCommentWebhookResult,
) {
  counters.claimed += result.kind === "skipped" ? 0 : 1;
  if (result.kind === "processed") counters.processed += 1;
  else if (result.kind === "ignored") counters.ignored += 1;
  else if (result.kind === "retry_scheduled") counters.retryScheduled += 1;
  else if (result.kind === "failed") counters.failed += 1;
  else counters.skipped += 1;
}

async function availableDeliveryIds({
  supabase,
  table,
  limit,
  eventName,
}: {
  supabase: SupabaseClient;
  table: "github_planning_webhook_deliveries" | "github_webhook_deliveries";
  limit: number;
  eventName?: string;
}) {
  const now = new Date();
  const staleBefore = new Date(now.getTime() - 2 * 60 * 1000).toISOString();
  const build = () => {
    let query = supabase.from(table).select("delivery_id,received_at");
    if (eventName) query = query.eq("event_name", eventName);
    return query;
  };
  const [ready, stale] = await Promise.all([
    build()
      .in("status", ["received", "retry_scheduled"])
      .lte("available_at", now.toISOString())
      .order("received_at", { ascending: true })
      .limit(limit),
    build()
      .eq("status", "processing")
      .lt("locked_at", staleBefore)
      .order("received_at", { ascending: true })
      .limit(limit),
  ]);
  if (ready.error || stale.error) {
    throw new Error(`GitHub webhook retry queue could not be loaded: ${ready.error?.message || stale.error?.message}`);
  }
  return [...new Map(
    [...(ready.data || []), ...(stale.data || [])]
      .filter((row): row is { delivery_id: string; received_at: string } => typeof row.delivery_id === "string")
      .sort((left, right) => String(left.received_at).localeCompare(String(right.received_at)))
      .map((row) => [row.delivery_id, row.delivery_id]),
  ).values()].slice(0, limit);
}

export async function drainGitHubWebhookDeliveries({
  supabase,
  limit = 25,
}: {
  supabase: SupabaseClient;
  limit?: number;
}): Promise<GitHubWebhookDrainResult> {
  const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 50);
  const projectionDispatch = await dispatchPlanningGitHubProjections({
    supabase,
    limit: boundedLimit,
  });
  const [planningIds, commentIds] = await Promise.all([
    availableDeliveryIds({ supabase, table: "github_planning_webhook_deliveries", limit: boundedLimit }),
    availableDeliveryIds({ supabase, table: "github_webhook_deliveries", eventName: "issue_comment", limit: boundedLimit }),
  ]);
  const planning = emptyCounters();
  const comments = emptyCounters();
  for (const deliveryId of planningIds) {
    recordResult(planning, await processGitHubPlanningWebhookDelivery({ deliveryId, supabase }));
  }
  const commentStore = createSupabaseGitHubIssueCommentWebhookStore(supabase);
  for (const deliveryId of commentIds) {
    recordResult(comments, await processGitHubIssueCommentWebhookDelivery({ deliveryId, store: commentStore }));
  }
  return {
    projection: {
      claimed: projectionDispatch.claimed,
      completed: projectionDispatch.completed,
      retryScheduled: projectionDispatch.retryScheduled,
      failed: projectionDispatch.failed,
    },
    planning,
    comments,
  };
}
