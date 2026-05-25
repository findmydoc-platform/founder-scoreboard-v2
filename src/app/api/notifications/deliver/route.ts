import { NextResponse, type NextRequest } from "next/server";
import { requireOperationalLead } from "@/lib/authz";
import { googleChatTarget, hasGoogleChatWebhook, sendGoogleChatWebhook, type GoogleChatDeliveryEvent } from "@/lib/google-chat";
import { getServerSupabase } from "@/lib/supabase";

type NotificationRow = {
  id: number;
  type: string;
  actor_profile_id: string | null;
  recipient_profile_id: string | null;
  entity_type: string;
  entity_id: string;
  title: string;
  body: string | null;
  created_at: string;
};

type ProfileRow = {
  id: string;
  name: string;
  google_chat_user_id: string | null;
  google_chat_dm_space: string | null;
  notifications_enabled: boolean | null;
};

function safeLimit(value: unknown) {
  const limit = Number(value || 20);
  if (!Number.isFinite(limit)) return 20;
  return Math.max(1, Math.min(50, Math.round(limit)));
}

function statusCodeForError(errorMessage: string) {
  if (errorMessage.includes("GOOGLE_CHAT_WEBHOOK_URL")) return 424;
  return 502;
}

export async function GET(request: NextRequest) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireOperationalLead(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  const { count, error } = await supabase
    .from("notification_events")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    googleChatConfigured: hasGoogleChatWebhook(),
    pending: count || 0,
  });
}

export async function POST(request: NextRequest) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireOperationalLead(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  const payload = (await request.json().catch(() => ({}))) as { limit?: number };
  const limit = safeLimit(payload.limit);

  const { data: events, error: eventError } = await supabase
    .from("notification_events")
    .select("id,type,actor_profile_id,recipient_profile_id,entity_type,entity_id,title,body,created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (eventError) return NextResponse.json({ error: eventError.message }, { status: 500 });
  if (!events?.length) return NextResponse.json({ ok: true, sent: 0, failed: 0, skipped: 0, results: [] });

  const profileIds = new Set<string>();
  for (const event of events as NotificationRow[]) {
    if (event.actor_profile_id) profileIds.add(event.actor_profile_id);
    if (event.recipient_profile_id) profileIds.add(event.recipient_profile_id);
  }

  const profileResult = profileIds.size
    ? await supabase
      .from("profiles")
      .select("id,name,google_chat_user_id,google_chat_dm_space,notifications_enabled")
      .in("id", [...profileIds])
    : { data: [] };

  const profiles = new Map((profileResult.data || []).map((profile: ProfileRow) => [profile.id, profile]));
  const results: Array<{ eventId: number; status: "sent" | "failed" | "skipped"; error?: string }> = [];

  for (const row of events as NotificationRow[]) {
    const actor = row.actor_profile_id ? profiles.get(row.actor_profile_id) : null;
    const recipient = row.recipient_profile_id ? profiles.get(row.recipient_profile_id) : null;
    const target = googleChatTarget(recipient ? {
      googleChatDmSpace: recipient.google_chat_dm_space || "",
      googleChatUserId: recipient.google_chat_user_id || "",
    } : null);
    const deliveryEvent: GoogleChatDeliveryEvent = {
      id: row.id,
      type: row.type,
      title: row.title,
      body: row.body || "",
      entityType: row.entity_type,
      entityId: row.entity_id,
      createdAt: row.created_at,
      actorName: actor?.name || "",
      recipientName: recipient?.name || "",
    };

    if (recipient?.notifications_enabled === false) {
      await supabase.from("notification_events").update({ status: "dismissed" }).eq("id", row.id);
      await supabase.from("notification_deliveries").insert({
        event_id: row.id,
        channel: "google_chat",
        status: "failed",
        attempts: 0,
        target,
        payload: deliveryEvent,
        last_error: "Benachrichtigungen fuer Empfaenger deaktiviert.",
      });
      results.push({ eventId: row.id, status: "skipped", error: "Benachrichtigungen deaktiviert." });
      continue;
    }

    try {
      await sendGoogleChatWebhook(deliveryEvent);
      await supabase.from("notification_deliveries").insert({
        event_id: row.id,
        channel: "google_chat",
        status: "sent",
        attempts: 1,
        target,
        payload: deliveryEvent,
        delivered_at: new Date().toISOString(),
      });
      await supabase.from("notification_events").update({ status: "sent" }).eq("id", row.id);
      results.push({ eventId: row.id, status: "sent" });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Google Chat Versand fehlgeschlagen.";
      await supabase.from("notification_deliveries").insert({
        event_id: row.id,
        channel: "google_chat",
        status: "failed",
        attempts: 1,
        target,
        payload: deliveryEvent,
        last_error: message,
      });
      await supabase.from("notification_events").update({ status: "failed" }).eq("id", row.id);
      results.push({ eventId: row.id, status: "failed", error: message });
    }
  }

  const sent = results.filter((result) => result.status === "sent").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;

  if (failed && !sent) {
    const errorMessage = results.find((result) => result.error)?.error || "Google Chat Versand fehlgeschlagen.";
    return NextResponse.json({ error: errorMessage, sent, failed, skipped, results }, { status: statusCodeForError(errorMessage) });
  }

  return NextResponse.json({ ok: true, sent, failed, skipped, results });
}
