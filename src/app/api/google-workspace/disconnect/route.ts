import { type NextRequest, NextResponse } from "next/server";
import {
  disconnectGoogleWorkspace,
  getGoogleWorkspaceDisconnectView,
  GoogleWorkspaceDisconnectError,
} from "@/features/team-workweek/server/google-workspace-disconnect";
import { requireTeamWorkweekStarterApiAccess } from "@/features/team-workweek/server/team-workweek-rollout-api";
import { apiError, readJsonPayload, requireApiContext } from "@/lib/api-response";
import { requirePlanningContributor } from "@/lib/authz";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const apiContext = await requireApiContext(request, requirePlanningContributor);
  if (!apiContext.ok) return apiContext.response;
  const ownerProfileId = apiContext.permission.profile?.id;
  if (!ownerProfileId) return apiError("Gebundenes Teamprofil erforderlich.", 403);
  const rollout = await requireTeamWorkweekStarterApiAccess({
    actorProfileId: ownerProfileId,
    actorRole: apiContext.permission.profile?.platformRole,
  });
  if (!rollout.ok) return rollout.response;
  const serviceSupabase = getServerServiceRoleSupabase();
  if (!serviceSupabase) return apiError("Trennungsvorschau ist nicht verfügbar.", 503);
  try {
    const disconnect = await getGoogleWorkspaceDisconnectView(serviceSupabase, ownerProfileId);
    return NextResponse.json({ disconnect });
  } catch {
    return apiError("Trennungsvorschau ist nicht verfügbar.", 503);
  }
}

export async function POST(request: NextRequest) {
  const apiContext = await requireApiContext(request, requirePlanningContributor);
  if (!apiContext.ok) return apiContext.response;
  const ownerProfileId = apiContext.permission.profile?.id;
  if (!ownerProfileId) return apiError("Gebundenes Teamprofil erforderlich.", 403);
  const rollout = await requireTeamWorkweekStarterApiAccess({
    actorProfileId: ownerProfileId,
    actorRole: apiContext.permission.profile?.platformRole,
  });
  if (!rollout.ok) return rollout.response;
  const payload = await readJsonPayload<unknown>(request, null);
  const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  if (Object.keys(input).some((key) => key !== "confirm") || input.confirm !== true) {
    return apiError("Trennung muss ausdrücklich bestätigt werden.", 400);
  }
  const serviceSupabase = getServerServiceRoleSupabase();
  if (!serviceSupabase) return apiError("Trennung ist nicht verfügbar.", 503);
  try {
    const result = await disconnectGoogleWorkspace({ ownerProfileId, serviceSupabase });
    return NextResponse.json({ result }, { status: result.state === "completed" ? 200 : 202 });
  } catch (error) {
    if (error instanceof GoogleWorkspaceDisconnectError) {
      return apiError(error.message, error.code === "conflict" ? 409 : 503);
    }
    return apiError("Google-Verbindung konnte nicht getrennt werden.", 503);
  }
}
