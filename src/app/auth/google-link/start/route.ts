import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { getServerAuthSupabase } from "@/lib/supabase-server";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";
import { authOrigin } from "@/lib/auth-redirect";
import { sha256 } from "@/lib/workspace-data-fetch";

export async function POST(request: NextRequest) {
  try {
    const origin = authOrigin();
    if (request.headers.get("origin") !== origin) return new NextResponse(null, { status: 403 });
    const supabase = await getServerAuthSupabase();
    const service = getServerServiceRoleSupabase();
    const user = supabase ? (await supabase.auth.getUser()).data.user : null;
    if (!supabase || !service || !user) return new NextResponse(null, { status: 401 });
    const nonce = randomBytes(32).toString("base64url");
    const attempt = await service.rpc("workspace_begin_link", { p_user_id: user.id, p_nonce_hash: sha256(nonce) });
    if (attempt.error) return new NextResponse(null, { status: 403 });
    const { data, error } = await supabase.auth.linkIdentity({ provider: "google", options: {
      redirectTo: `${origin}/auth/callback?link=google`, skipBrowserRedirect: true,
      scopes: "openid email profile", queryParams: { include_granted_scopes: "false", hd: "findmydoc.eu", prompt: "select_account" },
    } });
    if (error || !data.url) throw new Error("Link unavailable");
    (await cookies()).set("workspace_link", nonce, { httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax", path: "/auth", maxAge: 600 });
    return NextResponse.redirect(data.url, 303);
  } catch { return NextResponse.redirect(new URL("/auth/error", request.url), 303); }
}
