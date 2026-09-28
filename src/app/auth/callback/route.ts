import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { getServerAuthSupabase } from "@/lib/supabase-server";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";
import { requireWorkspaceAccess } from "@/lib/workspace-access";
import { sha256 } from "@/lib/workspace-data-fetch";
import { authOrigin, safeRelativeNext } from "@/lib/auth-redirect";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const next = safeRelativeNext(request.nextUrl.searchParams.get("next"));
  const supabase = await getServerAuthSupabase();
  try {
    const origin = authOrigin();
    const code = request.nextUrl.searchParams.get("code");
    if (!code || !supabase) throw new Error("Missing callback");
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (error || !data.user || !data.session) throw new Error("Invalid callback");
    // Supabase initially includes the OAuth provider token. Replace that session before sending cookies.
    const clean = await supabase.auth.setSession({ access_token: data.session.access_token, refresh_token: data.session.refresh_token });
    if (clean.error) throw new Error("Session unavailable");
    if (request.nextUrl.searchParams.get("link") === "google") {
      const jar = await cookies();
      const nonce = jar.get("workspace_link")?.value;
      jar.set("workspace_link", "", { path: "/auth", maxAge: 0, httpOnly: true, sameSite: "lax" });
      if (!nonce) throw new Error("Missing linking attempt");
      const identity = await requireWorkspaceAccess({ userId: data.user.id }, false);
      const service = getServerServiceRoleSupabase();
      if (!identity || !service) throw new Error("Link unavailable");
      const result = await service.rpc("workspace_complete_link", { p_user_id: data.user.id, p_nonce_hash: sha256(nonce), p_subject: identity.subject });
      if (result.error) throw new Error("Link rejected");
      return NextResponse.redirect(`${origin}/auth/link-google`);
    }
    await requireWorkspaceAccess({ userId: data.user.id });
    return NextResponse.redirect(new URL(next, origin));
  } catch {
    await supabase?.auth.signOut({ scope: "local" });
    return NextResponse.redirect(new URL(`/auth/error?next=${encodeURIComponent(next)}`, request.url));
  }
}
