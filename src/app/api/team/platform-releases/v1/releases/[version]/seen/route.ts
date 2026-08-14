import type { NextRequest } from "next/server";
import { requireTeamMember } from "@/lib/authz";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";

export async function POST(request: NextRequest, context: RouteContext<"/api/team/platform-releases/v1/releases/[version]/seen">) {
  const auth = await requireTeamMember(request);
  if (!auth.ok) return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!auth.profile) return Response.json({ ok: true });
  const { version } = await context.params;
  if (!/^v\d+\.\d+\.\d+$/.test(version)) return Response.json({ ok: false, error: "Ungültige Version." }, { status: 400 });
  const supabase = getServerServiceRoleSupabase();
  if (!supabase) return Response.json({ ok: false, error: "Lesestatus ist nicht verfügbar." }, { status: 503 });
  const { error } = await supabase
    .from("notification_events")
    .update({ seen_at: new Date().toISOString() })
    .eq("recipient_profile_id", auth.profile.id)
    .eq("entity_type", "platform_release")
    .eq("entity_id", version)
    .is("seen_at", null);
  if (error) return Response.json({ ok: false, error: "Lesestatus konnte nicht gespeichert werden." }, { status: 500 });
  return Response.json({ ok: true });
}
