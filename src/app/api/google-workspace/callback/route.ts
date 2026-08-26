import { NextResponse, type NextRequest } from "next/server";
import {
  exchangeGoogleWorkspaceCode,
  probeGoogleWorkspacePrimaryCalendar,
  storeGoogleWorkspaceConnection,
  verifyBoundGoogleWorkspaceState,
} from "@/features/team-workweek/server/google-workspace-oauth";
import { requireTeamWorkweekStarterApiAccess } from "@/features/team-workweek/server/team-workweek-rollout-api";
import { getServerPlanningAuth } from "@/lib/planning-auth-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code") || "";
  const stateValue = request.nextUrl.searchParams.get("state") || "";
  let next = "/team";

  try {
    if (!code || !stateValue) throw new Error("Google Workspace callback is incomplete.");
    const auth = await getServerPlanningAuth(["ceo", "founder"]);
    if (!auth.ok || !auth.profile) throw new Error("FounderOps session is unavailable.");
    const rollout = await requireTeamWorkweekStarterApiAccess({
      actorProfileId: auth.profile.id,
      actorRole: auth.profile.platformRole,
    });
    if (!rollout.ok) {
      return NextResponse.redirect(new URL("/team?googleWorkspace=starter_disabled", request.url));
    }
    const state = verifyBoundGoogleWorkspaceState(stateValue, {
      userId: auth.user.id,
      profileId: auth.profile.id,
    });
    next = state.next;

    const supabase = rollout.serviceSupabase;
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
