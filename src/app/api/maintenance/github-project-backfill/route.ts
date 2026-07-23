import { NextResponse, type NextRequest } from "next/server";
import { apiError, supabaseUnavailable } from "@/lib/api-response";
import {
  FOUNDEROPS_DELIVERY_SECRET_HEADER,
  validateDeliverySecret,
} from "@/lib/delivery-auth";
import { getGitHubAppInstallationToken } from "@/lib/github-app";
import {
  normalizeFounderOpsGitHubProjectBackfillOptions,
  runFounderOpsGitHubProjectBackfill,
} from "@/lib/github-project-backfill";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const actorHeader = "x-founderops-github-actor";

async function runBackfill(request: NextRequest, dryRun: boolean) {
  if (!validateDeliverySecret(request.headers.get(FOUNDEROPS_DELIVERY_SECRET_HEADER))) {
    return apiError("Ungültiger Delivery-Secret.", 401);
  }

  const actorLogin = request.headers.get(actorHeader)?.trim() || "";
  if (!/^[A-Za-z0-9-]{1,39}$/.test(actorLogin)) {
    return apiError("GitHub-Akteur fehlt oder ist ungültig.", 403);
  }
  const supabase = getServerServiceRoleSupabase();
  if (!supabase) return supabaseUnavailable();

  const { data: actorProfiles, error: actorError } = await supabase
    .from("profiles")
    .select("id,github_login,platform_role")
    .ilike("github_login", actorLogin)
    .limit(2);
  if (actorError || (actorProfiles || []).length !== 1 || actorProfiles?.[0]?.platform_role !== "ceo") {
    return apiError("GitHub-Akteur ist nicht dem FounderOps-CEO-Profil zugeordnet.", 403);
  }

  let input: Record<string, unknown>;
  try {
    input = dryRun
      ? Object.fromEntries(request.nextUrl.searchParams.entries())
      : await request.json() as Record<string, unknown>;
  } catch {
    return apiError("Backfill-Anfrage ist ungültig.", 400);
  }

  let options;
  try {
    options = normalizeFounderOpsGitHubProjectBackfillOptions(input, dryRun);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Backfill-Anfrage ist ungültig.", 400);
  }

  try {
    const token = await getGitHubAppInstallationToken();
    const report = await runFounderOpsGitHubProjectBackfill({
      actorProfileId: actorProfiles[0].id,
      options,
      supabase,
      token,
    });
    return NextResponse.json({
      ok: report.invalidTasks.length === 0 && report.summary.errors === 0,
      report,
    });
  } catch {
    return apiError("GitHub-Project-Backfill konnte nicht ausgeführt werden.", 502);
  }
}

export async function GET(request: NextRequest) {
  return runBackfill(request, true);
}

export async function POST(request: NextRequest) {
  return runBackfill(request, false);
}
