import { NextRequest, NextResponse } from "next/server";
import { getServerAuthSupabase } from "@/lib/supabase-server";
import { workspaceAccessContext } from "@/lib/workspace-access";
import { authOrigin, safeRelativeNext } from "@/lib/auth-redirect";

export async function GET(request: NextRequest) {
  try {
    const origin = authOrigin();
    const { mode } = await workspaceAccessContext();
    const provider = mode === "legacy" || (mode === "linking" && request.nextUrl.searchParams.get("provider") === "github") ? "github" : "google";
    const supabase = await getServerAuthSupabase();
    if (!supabase) throw new Error("Auth unavailable");
    const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(safeRelativeNext(request.nextUrl.searchParams.get("next")))}`;
    const { data, error } = await supabase.auth.signInWithOAuth({ provider, options: {
      redirectTo, skipBrowserRedirect: true,
      scopes: provider === "google" ? "openid email profile" : "read:user user:email",
      queryParams: provider === "google" ? { include_granted_scopes: "false", hd: "findmydoc.eu" } : undefined,
    } });
    if (error || !data.url) throw new Error("Auth unavailable");
    return NextResponse.redirect(data.url);
  } catch { return NextResponse.redirect(new URL("/auth/error", request.url)); }
}
