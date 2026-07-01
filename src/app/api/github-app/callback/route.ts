import { NextResponse, type NextRequest } from "next/server";
import { exchangeGitHubAppCode, githubUserForAppUserToken, storeGitHubAppUserToken, verifyGitHubAppOAuthState } from "@/lib/github-app";
import { getServerPlanningAuth } from "@/lib/planning-auth-server";
import { getServerSupabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function redirectError(request: NextRequest, next: string) {
  return NextResponse.redirect(new URL(`/auth/error?next=${encodeURIComponent(next)}`, request.url));
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code") || "";
  const stateValue = request.nextUrl.searchParams.get("state") || "";
  let next = "/";

  try {
    if (!code || !stateValue) throw new Error("GitHub Callback ist unvollständig.");
    const state = verifyGitHubAppOAuthState(stateValue);
    next = state.next || "/";

    const auth = await getServerPlanningAuth(["ceo", "founder", "deputy", "viewer"]);
    if (!auth.ok || !auth.profile || auth.user.id !== state.userId || auth.profile.id !== state.profileId) {
      return redirectError(request, next);
    }

    const supabase = getServerSupabase();
    if (!supabase) throw new Error("Supabase Service Role ist nicht konfiguriert.");

    const redirectUri = new URL("/api/github-app/callback", request.url).toString();
    const token = await exchangeGitHubAppCode(code, redirectUri);
    const githubUser = await githubUserForAppUserToken(token.access_token || "");
    await storeGitHubAppUserToken({ supabase, profile: auth.profile, githubUser, token });

    return NextResponse.redirect(new URL(next, request.url));
  } catch {
    return redirectError(request, next);
  }
}
