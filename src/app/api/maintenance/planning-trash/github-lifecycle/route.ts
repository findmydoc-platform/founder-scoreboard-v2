import { NextResponse, type NextRequest } from "next/server";
import { apiError, supabaseUnavailable } from "@/lib/api-response";
import {
  FOUNDEROPS_MAINTENANCE_SECRET_HEADER,
  validateMaintenanceSecret,
} from "@/lib/maintenance-auth";
import { drainPlanningGitHubLifecycleJobs } from "@/lib/planning-github-lifecycle";
import { dispatchPlanningGitHubProjections } from "@/features/planning-items/model/planning-items-github-projection";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!validateMaintenanceSecret(request.headers.get(FOUNDEROPS_MAINTENANCE_SECRET_HEADER))) {
    return apiError("Ungültiger Maintenance-Secret.", 401);
  }

  const supabase = getServerServiceRoleSupabase();
  if (!supabase) return supabaseUnavailable();

  try {
    const lifecycle = await drainPlanningGitHubLifecycleJobs({ supabase, limit: 25 });
    const projection = await dispatchPlanningGitHubProjections({ supabase, limit: 25 });
    const [terminalResult, outstandingResult, outstandingProjectionResult] = await Promise.all([
      supabase
        .from("planning_github_lifecycle_outbox")
        .select("id", { count: "exact", head: true })
        .eq("status", "failed"),
      supabase
        .from("planning_github_lifecycle_outbox")
        .select("id", { count: "exact", head: true })
        .neq("status", "completed"),
      supabase
        .from("planning_github_projection_outbox")
        .select("id", { count: "exact", head: true })
        .neq("status", "completed"),
    ]);
    if (terminalResult.error || outstandingResult.error || outstandingProjectionResult.error) {
      throw new Error("Planning trash lifecycle state could not be loaded.");
    }
    const terminalFailed = terminalResult.count;
    const outstandingLifecycleJobs = outstandingResult.count;
    const outstandingProjectionRequests = outstandingProjectionResult.count;
    if (
      typeof terminalFailed !== "number"
      || !Number.isSafeInteger(terminalFailed)
      || terminalFailed < 0
      || typeof outstandingLifecycleJobs !== "number"
      || !Number.isSafeInteger(outstandingLifecycleJobs)
      || outstandingLifecycleJobs < 0
      || typeof outstandingProjectionRequests !== "number"
      || !Number.isSafeInteger(outstandingProjectionRequests)
      || outstandingProjectionRequests < 0
    ) {
      throw new Error("Planning trash lifecycle state was invalid.");
    }
    return NextResponse.json({
      ok: true,
      ...lifecycle,
      projection: {
        claimed: projection.claimed,
        completed: projection.completed,
        retryScheduled: projection.retryScheduled,
        failed: projection.failed,
      },
      terminalFailed,
      outstandingLifecycleJobs,
      outstandingProjectionRequests,
    });
  } catch {
    return apiError("GitHub-Lifecycle des Planungspapierkorbs konnte nicht verarbeitet werden.", 500);
  }
}
