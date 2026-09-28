import { NextResponse } from "next/server";
import { getServerAuthSupabase } from "@/lib/supabase-server";
import { workspaceAccessContext } from "@/lib/workspace-access";
import { workspaceIdentity } from "@/lib/workspace-identity";

export async function GET() {
  try {
    const supabase = await getServerAuthSupabase();
    const { data, error } = supabase ? await supabase.auth.getUser() : { data: { user: null }, error: null };
    if (error || !data.user) return NextResponse.json({ linked: false }, { status: 401, headers: { "Cache-Control": "no-store" } });
    const context = await workspaceAccessContext({ userId: data.user.id });
    if (!context.linked || !context.identity) return NextResponse.json({ linked: false }, { headers: { "Cache-Control": "no-store" } });
    const identity = workspaceIdentity({ id: data.user.id, identities: [{ provider: "google", identity_data: context.identity }] });
    return NextResponse.json({ linked: true, workspaceEmail: identity.email }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ linked: false }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
