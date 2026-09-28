import { NextRequest, NextResponse } from "next/server";
import { getServerAuthSupabase } from "@/lib/supabase-server";
import { workspaceAccessContext } from "@/lib/workspace-access";
import { authOrigin, safeRelativeNext } from "@/lib/auth-redirect";
import { randomBytes } from "node:crypto";

export async function GET(request: NextRequest) {
  try {
    const origin = authOrigin();
    const { mode } = await workspaceAccessContext();
    const provider = mode === "legacy" || (mode === "linking" && request.nextUrl.searchParams.get("provider") === "github") ? "github" : "google";
    const supabase = await getServerAuthSupabase();
    if (!supabase) throw new Error("Auth unavailable");
    const loginNonce = provider === "google" ? randomBytes(32).toString("base64url") : "";
    const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(safeRelativeNext(request.nextUrl.searchParams.get("next")))}${loginNonce ? `&login=${loginNonce}` : ""}`;
    const { data, error } = await supabase.auth.signInWithOAuth({ provider, options: {
      redirectTo, skipBrowserRedirect: true,
      scopes: provider === "google" ? "openid email profile" : "read:user user:email",
      queryParams: provider === "google" ? { include_granted_scopes: "false", hd: "findmydoc.eu" } : undefined,
    } });
    if (error || !data.url) throw new Error("Auth unavailable");
    const response = NextResponse.redirect(data.url);
    response.cookies.set("workspace_google_login", loginNonce, {
      path: "/auth", httpOnly: true, secure: origin.startsWith("https:"), sameSite: "lax", maxAge: loginNonce ? 600 : 0,
    });
    return response;
  } catch { return NextResponse.redirect(new URL("/auth/error", request.url)); }
}
