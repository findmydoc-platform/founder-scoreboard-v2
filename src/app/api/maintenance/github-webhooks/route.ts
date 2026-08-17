import { NextResponse, type NextRequest } from "next/server";
import { apiError, supabaseUnavailable } from "@/lib/api-response";
import { drainGitHubWebhookDeliveries } from "@/lib/github-webhook-drain";
import {
  FOUNDEROPS_MAINTENANCE_SECRET_HEADER,
  validateMaintenanceSecret,
} from "@/lib/maintenance-auth";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!validateMaintenanceSecret(request.headers.get(FOUNDEROPS_MAINTENANCE_SECRET_HEADER))) {
    return apiError("Ungültiger Maintenance-Secret.", 401);
  }
  const supabase = getServerServiceRoleSupabase();
  if (!supabase) return supabaseUnavailable();

  try {
    const deliveries = await drainGitHubWebhookDeliveries({ supabase, limit: 25 });
    const [planningFailed, planningOutstanding, commentFailed, commentOutstanding, projectionFailed, projectionOutstanding] = await Promise.all([
      supabase.from("github_planning_webhook_deliveries").select("delivery_id", { count: "exact", head: true }).eq("status", "failed"),
      supabase.from("github_planning_webhook_deliveries").select("delivery_id", { count: "exact", head: true }).in("status", ["received", "processing", "retry_scheduled"]),
      supabase.from("github_webhook_deliveries").select("delivery_id", { count: "exact", head: true }).eq("event_name", "issue_comment").eq("status", "failed"),
      supabase.from("github_webhook_deliveries").select("delivery_id", { count: "exact", head: true }).eq("event_name", "issue_comment").in("status", ["received", "processing", "retry_scheduled"]),
      supabase.from("planning_github_projection_outbox").select("id", { count: "exact", head: true }).eq("source_kind", "github_webhook").eq("status", "failed"),
      supabase.from("planning_github_projection_outbox").select("id", { count: "exact", head: true }).eq("source_kind", "github_webhook").in("status", ["pending", "processing", "retry_scheduled"]),
    ]);
    const counts = [planningFailed, planningOutstanding, commentFailed, commentOutstanding, projectionFailed, projectionOutstanding];
    if (counts.some((result) => result.error || !Number.isSafeInteger(result.count) || Number(result.count) < 0)) {
      throw new Error("GitHub webhook queue state could not be loaded.");
    }
    return NextResponse.json({
      ok: true,
      ...deliveries,
      projectionTerminalFailed: Number(projectionFailed.count),
      projectionOutstanding: Number(projectionOutstanding.count),
      terminalFailed: Number(planningFailed.count) + Number(commentFailed.count) + Number(projectionFailed.count),
      outstanding: Number(planningOutstanding.count) + Number(commentOutstanding.count) + Number(projectionOutstanding.count),
    });
  } catch {
    return apiError("GitHub-Webhook-Ereignisse konnten nicht verarbeitet werden.", 500);
  }
}
