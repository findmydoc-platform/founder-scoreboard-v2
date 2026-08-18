import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError, supabaseUnavailable } from "@/lib/api-response";
import { drainGitHubWebhookDeliveries } from "@/lib/github-webhook-drain";
import { hasCronSecret, validateCronSecret } from "@/lib/maintenance-auth";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type TerminalFailureReason = Readonly<{ reason: string; count: number }>;
type TerminalFailureReasons = Readonly<{
  planning: TerminalFailureReason[];
  comments: TerminalFailureReason[];
  projection: TerminalFailureReason[];
}>;

function summarizeTerminalFailureReasons(rows: Array<{ status_reason?: string | null }>): TerminalFailureReason[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const reason = row.status_reason?.trim() || "unknown";
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => left.reason.localeCompare(right.reason));
}

async function loadTerminalFailureReasons(supabase: SupabaseClient) {
  const [planning, comments, projection] = await Promise.all([
    supabase.from("github_planning_webhook_deliveries").select("status_reason").eq("status", "failed"),
    supabase.from("github_webhook_deliveries").select("status_reason").eq("event_name", "issue_comment").eq("status", "failed"),
    supabase.from("planning_github_projection_outbox").select("status_reason").eq("source_kind", "github_webhook").eq("status", "failed"),
  ]);
  if (planning.error || comments.error || projection.error) {
    throw new Error("GitHub webhook terminal failure reasons could not be loaded.");
  }
  return {
    planning: summarizeTerminalFailureReasons(planning.data || []),
    comments: summarizeTerminalFailureReasons(comments.data || []),
    projection: summarizeTerminalFailureReasons(projection.data || []),
  } satisfies TerminalFailureReasons;
}

function terminalFailureCount(reasons: TerminalFailureReason[]) {
  return reasons.reduce((total, reason) => total + reason.count, 0);
}

export async function GET(request: NextRequest) {
  if (!hasCronSecret()) {
    return apiError("GitHub-Webhook-Cron ist nicht konfiguriert.", 503);
  }
  if (!validateCronSecret(request.headers.get("authorization"))) {
    return apiError("Ungültiger Cron-Secret.", 401);
  }
  const supabase = getServerServiceRoleSupabase();
  if (!supabase) return supabaseUnavailable();

  try {
    const deliveries = await drainGitHubWebhookDeliveries({ supabase, limit: 25 });
    const [terminalFailureReasons, planningOutstanding, commentOutstanding, projectionOutstanding] = await Promise.all([
      loadTerminalFailureReasons(supabase),
      supabase.from("github_planning_webhook_deliveries").select("delivery_id", { count: "exact", head: true }).in("status", ["received", "processing", "retry_scheduled"]),
      supabase.from("github_webhook_deliveries").select("delivery_id", { count: "exact", head: true }).eq("event_name", "issue_comment").in("status", ["received", "processing", "retry_scheduled"]),
      supabase.from("planning_github_projection_outbox").select("id", { count: "exact", head: true }).eq("source_kind", "github_webhook").in("status", ["pending", "processing", "retry_scheduled"]),
    ]);
    const counts = [planningOutstanding, commentOutstanding, projectionOutstanding];
    if (counts.some((result) => result.error || !Number.isSafeInteger(result.count) || Number(result.count) < 0)) {
      throw new Error("GitHub webhook queue state could not be loaded.");
    }
    const projectionTerminalFailed = terminalFailureCount(terminalFailureReasons.projection);
    const terminalFailed = terminalFailureCount(terminalFailureReasons.planning)
      + terminalFailureCount(terminalFailureReasons.comments)
      + projectionTerminalFailed;
    const projectionDispatchFailed = deliveries.projection.failed;
    const unhealthy = terminalFailed > 0 || projectionDispatchFailed > 0;
    if (unhealthy) {
      console.error("GitHub webhook maintenance is unhealthy.", {
        terminalFailed,
        projectionDispatchFailed,
        terminalFailureReasons,
      });
    }
    return NextResponse.json({
      ok: !unhealthy,
      ...deliveries,
      projectionTerminalFailed,
      projectionDispatchFailed,
      projectionOutstanding: Number(projectionOutstanding.count),
      terminalFailed,
      terminalFailureReasons,
      outstanding: Number(planningOutstanding.count) + Number(commentOutstanding.count) + Number(projectionOutstanding.count),
    }, { status: unhealthy ? 503 : 200 });
  } catch {
    return apiError("GitHub-Webhook-Ereignisse konnten nicht verarbeitet werden.", 500);
  }
}
