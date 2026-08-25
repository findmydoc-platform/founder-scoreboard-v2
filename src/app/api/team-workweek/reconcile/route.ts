import { type NextRequest, NextResponse } from "next/server";
import {
  reconcileTeamWorkweek,
  TeamWorkweekReconciliationError,
} from "@/features/team-workweek/server/team-workweek-reconciliation";
import { apiError, readJsonPayload, requireApiContext } from "@/lib/api-response";
import { bearerToken, requirePlanningContributor } from "@/lib/authz";
import { getSupabaseForToken } from "@/lib/supabase";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const context = await requireApiContext(request, requirePlanningContributor);
  if (!context.ok) return context.response;
  const ownerProfileId = context.permission.profile?.id || null;
  const token = bearerToken(request);
  const userSupabase = token ? getSupabaseForToken(token) : null;
  const serviceSupabase = getServerServiceRoleSupabase();
  if (!ownerProfileId || !userSupabase) return apiError("Anmeldung erforderlich.", 401);
  if (!serviceSupabase) return apiError("Google-Abgleich ist derzeit nicht verfügbar.", 503);

  const payload = await readJsonPayload<unknown>(request, null);
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || Object.keys(payload).length) {
    return apiError("Google-Abgleich akzeptiert keine frei gewählten Ziele.", 400);
  }

  try {
    const reconciliation = await reconcileTeamWorkweek({
      ownerProfileId,
      serviceSupabase,
      userSupabase,
    });
    return NextResponse.json({ reconciliation }, {
      status: reconciliation.state === "delayed" ? 202 : reconciliation.state === "conflict" ? 409 : 200,
    });
  } catch (error) {
    if (!(error instanceof TeamWorkweekReconciliationError)) {
      return apiError("Google-Abgleich konnte nicht abgeschlossen werden.", 503);
    }
    const status = error.code === "not_found" ? 404 : error.code === "forbidden" ? 403 : error.code === "conflict" ? 409 : 503;
    return apiError(error.message, status);
  }
}
