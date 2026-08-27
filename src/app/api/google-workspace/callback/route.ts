import { NextResponse, type NextRequest } from "next/server";
import {
  exchangeGoogleWorkspaceCode,
  probeGoogleWorkspacePrimaryCalendar,
  storeGoogleWorkspaceConnection,
  verifyBoundGoogleWorkspaceState,
} from "@/features/team-workweek/server/google-workspace-oauth";
import { getServerPlanningAuth } from "@/lib/planning-auth-server";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code") || "";
  const stateValue = request.nextUrl.searchParams.get("state") || "";
  let next = "/team";

  try {
    if (!code || !stateValue) throw new Error("Google Workspace callback is incomplete.");
    const auth = await getServerPlanningAuth(["ceo", "founder", "deputy", "viewer"]);
    if (!auth.ok || !auth.profile) throw new Error("FounderOps session is unavailable.");
    const state = verifyBoundGoogleWorkspaceState(stateValue, {
      userId: auth.user.id,
      profileId: auth.profile.id,
    });
    next = state.next;

    const supabase = getServerServiceRoleSupabase();
    if (!supabase) throw new Error("FounderOps service is unavailable.");
    const redirectUri = new URL("/api/google-workspace/callback", request.url).toString();
    const token = await exchangeGoogleWorkspaceCode(code, redirectUri);
    await probeGoogleWorkspacePrimaryCalendar(token.accessToken);
    await storeGoogleWorkspaceConnection({ supabase, profileId: auth.profile.id, token });

    const success = new URL(next, request.url);
    success.searchParams.set("googleWorkspace", "connected");
    return NextResponse.redirect(success);
  } catch {
    return NextResponse.redirect(new URL("/team?googleWorkspace=connection_error", request.url));
  }
}
