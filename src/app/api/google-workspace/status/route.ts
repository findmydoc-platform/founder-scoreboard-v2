import { NextResponse, type NextRequest } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";
import { apiError, requireApiContext } from "@/lib/api-response";
import { requireTeamMember } from "@/lib/authz";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const context = await requireApiContext(request, requireTeamMember);
  if (!context.ok) return context.response;
  const profileId = context.permission.profile?.id || "";
  if (!profileId) return apiError("Teamprofil ist nicht verfügbar.", 403);
  const supabase = getServerServiceRoleSupabase();
  if (!supabase) return apiError("Google-Verbindungsstatus ist nicht verfügbar.", 503);

  try {
    const [connection, cleanup] = await Promise.all([
      authorizeCredentialAction({credential:{kind:"session-request",request},action:"google-calendar.connection.status",target:{ownerProfileId:profileId}}),
      supabase.from("google_workspace_disconnect_operations").select("id")
        .eq("owner_profile_id", profileId).neq("state", "completed").limit(1),
    ]);
    if (cleanup.error) return apiError("Google-Verbindungsstatus ist nicht verfügbar.", 503);
    return NextResponse.json({ connection, disconnectPending: Boolean(cleanup.data?.length) });
  } catch {
    return apiError("Google-Verbindungsstatus ist nicht verfügbar.", 503);
  }
}
