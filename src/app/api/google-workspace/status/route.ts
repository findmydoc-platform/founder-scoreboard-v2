import { NextResponse, type NextRequest } from "next/server";
import { getGoogleWorkspaceConnectionStatus } from "@/features/team-workweek/server/google-workspace-oauth";
import { requireTeamWorkweekStarterApiAccess } from "@/features/team-workweek/server/team-workweek-rollout-api";
import { apiError, requireApiContext } from "@/lib/api-response";
import { requireTeamMember } from "@/lib/authz";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const context = await requireApiContext(request, requireTeamMember);
  if (!context.ok) return context.response;
  const profileId = context.permission.profile?.id || "";
  if (!profileId) return apiError("Teamprofil ist nicht verfügbar.", 403);
  const rollout = await requireTeamWorkweekStarterApiAccess({
    actorProfileId: profileId,
    actorRole: context.permission.profile?.platformRole,
  });
  if (!rollout.ok) return rollout.response;
  const supabase = getServerServiceRoleSupabase();
  if (!supabase) return apiError("Google-Verbindungsstatus ist nicht verfügbar.", 503);

  try {
    const connection = await getGoogleWorkspaceConnectionStatus(supabase, profileId);
    return NextResponse.json({ connection });
  } catch {
    return apiError("Google-Verbindungsstatus ist nicht verfügbar.", 503);
  }
}
