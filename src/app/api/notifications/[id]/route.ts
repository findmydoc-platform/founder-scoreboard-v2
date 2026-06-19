import { NextResponse, type NextRequest } from "next/server";
import { requireFounder } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";
import { apiError, authzError, supabaseUnavailable } from "@/lib/api-response";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getServerSupabase();
  if (!supabase) return supabaseUnavailable();

  const permission = await requireFounder(request);
  if (!permission.ok) return authzError(permission);

  const { id } = await context.params;
  const notificationId = Number(id);
  if (!Number.isInteger(notificationId) || notificationId <= 0) {
    return apiError("Ungültige Notification.", 400);
  }

  const { data: event, error: readError } = await supabase
    .from("notification_events")
    .select("id,recipient_profile_id,status")
    .eq("id", notificationId)
    .single();

  if (readError || !event) return apiError("Notification wurde nicht gefunden.", 404);

  const canDismiss = !permission.profile
    || permission.profile.platformRole === "ceo"
    || permission.profile.platformRole === "deputy"
    || event.recipient_profile_id === permission.profile.id;

  if (!canDismiss) {
    return apiError("Keine Berechtigung für diese Notification.", 403);
  }

  const { error: updateError } = await supabase
    .from("notification_events")
    .update({ status: "dismissed" })
    .eq("id", notificationId);

  if (updateError) return apiError(updateError.message, 500);

  return NextResponse.json({ ok: true });
}
