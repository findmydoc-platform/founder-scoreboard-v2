import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getServerAuthSupabase } from "@/lib/supabase-server";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";
import { authOrigin } from "@/lib/auth-redirect";
import { sha256 } from "@/lib/workspace-data-fetch";
import { requireWorkspaceAccess } from "@/lib/workspace-access";

export async function POST(request: NextRequest) {
  try {
    const origin = authOrigin();
    if (request.headers.get("origin") !== origin) return new NextResponse(null, { status: 403 });
    const supabase = await getServerAuthSupabase();
    const service = getServerServiceRoleSupabase();
    const user = supabase ? (await supabase.auth.getUser()).data.user : null;
    if (!supabase || !service || !user) return new NextResponse(null, { status: 401 });
    const identities = user.identities;
    if (!Array.isArray(identities)) return new NextResponse(null, { status: 403 });
    const googleIdentities = identities.filter((identity) => identity.provider === "google");
    if (googleIdentities.length > 1) return new NextResponse(null, { status: 403 });
    const nonce = randomBytes(32).toString("base64url");
    const attempt = await service.rpc("workspace_begin_link", { p_user_id: user.id, p_nonce_hash: sha256(nonce) });
    if (attempt.error) return new NextResponse(null, { status: 403 });
    if (googleIdentities.length === 1) {
      const identity = await requireWorkspaceAccess({ userId: user.id }, false);
      if (!identity) return new NextResponse(null, { status: 403 });
      const completed = await service.rpc("workspace_complete_link", {
        p_user_id: user.id,
        p_nonce_hash: sha256(nonce),
        p_subject: identity.subject,
      });
      if (completed.error) return new NextResponse(null, { status: 403 });
      (await cookies()).set("workspace_link", "", { path: "/auth", maxAge: 0, httpOnly: true, sameSite: "lax" });
      return NextResponse.redirect(new URL("/auth/link-google", origin), 303);
    }
    const { data, error } = await supabase.auth.linkIdentity({ provider: "google", options: {
      redirectTo: `${origin}/auth/callback?link=google`, skipBrowserRedirect: true,
      scopes: "openid email profile", queryParams: { include_granted_scopes: "false", hd: "findmydoc.eu", prompt: "select_account" },
    } });
    if (error || !data.url) throw new Error("Link unavailable");
    (await cookies()).set("workspace_link", nonce, { httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax", path: "/auth", maxAge: 600 });
    return NextResponse.redirect(data.url, 303);
  } catch { return NextResponse.redirect(new URL("/auth/error", request.url), 303); }
}
