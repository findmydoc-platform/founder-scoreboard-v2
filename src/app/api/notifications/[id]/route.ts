import { NextResponse, type NextRequest } from "next/server";
import { requireFounder } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireFounder(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  const { id } = await context.params;
  const notificationId = Number(id);
  if (!Number.isInteger(notificationId) || notificationId <= 0) {
    return NextResponse.json({ error: "Ungültige Notification." }, { status: 400 });
  }

  const { data: event, error: readError } = await supabase
    .from("notification_events")
    .select("id,recipient_profile_id,status")
    .eq("id", notificationId)
    .single();

  if (readError || !event) return NextResponse.json({ error: "Notification wurde nicht gefunden." }, { status: 404 });

  const canDismiss = !permission.profile
    || permission.profile.platformRole === "ceo"
    || permission.profile.platformRole === "deputy"
    || event.recipient_profile_id === permission.profile.id;

  if (!canDismiss) {
    return NextResponse.json({ error: "Keine Berechtigung für diese Notification." }, { status: 403 });
  }

  const { error: updateError } = await supabase
    .from("notification_events")
    .update({ status: "dismissed" })
    .eq("id", notificationId);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
