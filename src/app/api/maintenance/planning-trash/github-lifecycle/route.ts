import { NextResponse, type NextRequest } from "next/server";
import { apiError, supabaseUnavailable } from "@/lib/api-response";
import {
  FOUNDEROPS_MAINTENANCE_SECRET_HEADER,
  validateMaintenanceSecret,
} from "@/lib/maintenance-auth";
import { drainPlanningGitHubLifecycleJobs } from "@/lib/planning-github-lifecycle";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!validateMaintenanceSecret(request.headers.get(FOUNDEROPS_MAINTENANCE_SECRET_HEADER))) {
    return apiError("Ungültiger Maintenance-Secret.", 401);
  }

  const supabase = getServerServiceRoleSupabase();
  if (!supabase) return supabaseUnavailable();

  try {
    const summary = await drainPlanningGitHubLifecycleJobs({ supabase, limit: 25 });
    return NextResponse.json({ ok: true, ...summary });
  } catch {
    return apiError("GitHub-Lifecycle des Planungspapierkorbs konnte nicht verarbeitet werden.", 500);
  }
}
