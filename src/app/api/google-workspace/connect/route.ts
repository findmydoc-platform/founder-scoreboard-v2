import { NextResponse, type NextRequest } from "next/server";
import {
  buildGoogleWorkspaceAuthorizationUrl,
  createBoundGoogleWorkspaceState,
} from "@/features/team-workweek/server/google-workspace-oauth";
import { getServerPlanningAuth } from "@/lib/planning-auth-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const auth = await getServerPlanningAuth(["ceo", "founder", "deputy"]);
  if (!auth.ok || !auth.profile) {
    return NextResponse.redirect(new URL("/auth/error?next=%2Fteam", request.url));
  }

  try {
    const redirectUri = new URL("/api/google-workspace/callback", request.url).toString();
    const state = createBoundGoogleWorkspaceState({
      userId: auth.user.id,
      profileId: auth.profile.id,
      next: request.nextUrl.searchParams.get("next") || "/team",
    });
    return NextResponse.redirect(buildGoogleWorkspaceAuthorizationUrl({ redirectUri, state }));
  } catch {
    return NextResponse.redirect(new URL("/team?googleWorkspace=configuration_error", request.url));
  }
}
