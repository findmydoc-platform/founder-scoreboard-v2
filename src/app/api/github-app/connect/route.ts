import { NextResponse, type NextRequest } from "next/server";
import { createGitHubAppOAuthState, githubAppAuthorizationUrl } from "@/lib/github-app";
import { getServerPlanningAuth } from "@/lib/planning-auth-server";

export const dynamic = "force-dynamic";

function safeRelativeNext(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const parsed = new URL(value, "http://localhost");
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "/";
  }
}

export async function GET(request: NextRequest) {
  const auth = await getServerPlanningAuth(["ceo", "founder", "deputy", "viewer"]);
  const next = safeRelativeNext(request.nextUrl.searchParams.get("next"));
  if (!auth.ok || !auth.profile) {
    return NextResponse.redirect(new URL(`/auth/error?next=${encodeURIComponent(next)}`, request.url));
  }

  const redirectUri = new URL("/api/github-app/callback", request.url).toString();
  const state = createGitHubAppOAuthState({
    userId: auth.user.id,
    profileId: auth.profile.id,
    next,
  });

  return NextResponse.redirect(githubAppAuthorizationUrl({ state, redirectUri }));
}
