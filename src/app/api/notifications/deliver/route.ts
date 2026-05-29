import { NextResponse, type NextRequest } from "next/server";
import { requireOperationalLead } from "@/lib/authz";
import {
  googleChatDeliveryStatus,
  googleChatTarget,
  isGoogleChatDmSpace,
  sendGoogleChatDigest,
  sendGoogleChatSpaceDigest,
  type GoogleChatDigestEvent,
} from "@/lib/google-chat";
import { shouldSendToGoogleChatDigest } from "@/lib/notification-policy";
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

type PreferenceRow = {
  profile_id: string;
  event_type: string;
  enabled: boolean;
};

type DeliveryRow = {
  row: NotificationRow;
  target: string;
  payload: GoogleChatDigestEvent;
};

function safeLimit(value: unknown) {
  const limit = Number(value || 20);
  if (!Number.isFinite(limit)) return 20;
  return Math.max(1, Math.min(50, Math.round(limit)));
}

function statusCodeForError(errorMessage: string) {
  if (errorMessage.includes("GOOGLE_CHAT_DELIVERY_ENABLED")) return 424;
  if (errorMessage.includes("GOOGLE_CHAT_WEBHOOK_URL")) return 424;
  if (errorMessage.includes("GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL")) return 424;
  if (errorMessage.includes("GOOGLE_CHAT_PRIVATE_KEY")) return 424;
  if (errorMessage.includes("DM-Space")) return 424;
  return 502;
}

function appUrlFromRequest(request: NextRequest) {
  const configured = process.env.APP_URL?.trim();
  if (configured) return configured.replace(/\/$/, "");
  const proto = request.headers.get("x-forwarded-proto") || "http";
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "localhost:3000";
  return `${proto}://${host}`;
}

async function insertDeliveryRows(
  supabase: ReturnType<typeof getServerSupabase>,
  rows: DeliveryRow[],
  status: "sent" | "failed",
  attempts: number,
  extras: { deliveredAt?: string; deliveryMode?: "direct_dm" | "webhook_digest"; error?: string; digestSize?: number },
) {
  if (!supabase || !rows.length) return;
  await supabase.from("notification_deliveries").insert(
    rows.map(({ row, target, payload }) => ({
      event_id: row.id,
      channel: "google_chat",
      status,
      attempts,
      target,
      payload: {
        ...payload,
        ...(extras.deliveryMode ? { deliveryMode: extras.deliveryMode } : {}),
        ...(extras.digestSize ? { digestSize: extras.digestSize } : {}),
      },
      delivered_at: extras.deliveredAt || null,
      last_error: extras.error || null,
    })),
  );
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

  const status = googleChatDeliveryStatus();
  return NextResponse.json({
    ok: true,
    googleChat: status,
    googleChatConfigured: status.webhookConfigured || status.apiConfigured,
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
  const deliveryStatus = googleChatDeliveryStatus();

  if (!deliveryStatus.ready) {
    const missing = deliveryStatus.webhookConfigured || deliveryStatus.apiConfigured
      ? "GOOGLE_CHAT_DELIVERY_ENABLED ist nicht auf true gesetzt."
      : "GOOGLE_CHAT_WEBHOOK_URL oder Google-Chat-Service-Account ist nicht gesetzt.";
    return NextResponse.json({
      error: missing,
      sent: 0,
      failed: 0,
      skipped: 0,
      googleChat: deliveryStatus,
    }, { status: 424 });
  }

  const { data: events, error: eventError } = await supabase
    .from("notification_events")
    .select("id,type,actor_profile_id,recipient_profile_id,entity_type,entity_id,title,body,created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (eventError) return NextResponse.json({ error: eventError.message }, { status: 500 });
  if (!events?.length) return NextResponse.json({ ok: true, sent: 0, failed: 0, skipped: 0, results: [] });

  const eventIds = (events as NotificationRow[]).map((event) => event.id);
  const { data: existingDeliveries, error: deliveryReadError } = await supabase
    .from("notification_deliveries")
    .select("event_id,status")
    .eq("channel", "google_chat")
    .in("event_id", eventIds);

  if (deliveryReadError) return NextResponse.json({ error: deliveryReadError.message }, { status: 500 });

  const alreadyDelivered = new Set(
    (existingDeliveries || [])
      .filter((delivery: { event_id: number; status: string }) => delivery.status === "sent")
      .map((delivery: { event_id: number }) => delivery.event_id),
  );

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

  const preferenceResult = profileIds.size
    ? await supabase
      .from("notification_preferences")
      .select("profile_id,event_type,enabled")
      .eq("channel", "google_chat")
      .in("profile_id", [...profileIds])
    : { data: [] };

  if ("error" in preferenceResult && preferenceResult.error) {
    return NextResponse.json({ error: preferenceResult.error.message }, { status: 500 });
  }

  const profiles = new Map((profileResult.data || []).map((profile: ProfileRow) => [profile.id, profile]));
  const preferences = new Map(
    (preferenceResult.data || []).map((preference: PreferenceRow) => [`${preference.profile_id}:${preference.event_type}`, preference.enabled]),
  );
  const results: Array<{ eventId: number; status: "sent" | "failed" | "skipped"; error?: string }> = [];
  const deliverableRows: DeliveryRow[] = [];

  for (const row of events as NotificationRow[]) {
    const actor = row.actor_profile_id ? profiles.get(row.actor_profile_id) : null;
    const recipient = row.recipient_profile_id ? profiles.get(row.recipient_profile_id) : null;
    const target = googleChatTarget(recipient ? {
      googleChatDmSpace: recipient.google_chat_dm_space || "",
      googleChatUserId: recipient.google_chat_user_id || "",
    } : null);
    const deliveryEvent: GoogleChatDigestEvent = {
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

    if (alreadyDelivered.has(row.id)) {
      results.push({ eventId: row.id, status: "skipped", error: "Bereits im Google-Chat-Digest gesendet." });
      continue;
    }

    if (!shouldSendToGoogleChatDigest(row.type)) {
      results.push({ eventId: row.id, status: "skipped", error: "Nur In-App-Benachrichtigung." });
      continue;
    }

    if (recipient?.notifications_enabled === false) {
      await insertDeliveryRows(supabase, [{ row, target, payload: deliveryEvent }], "failed", 0, {
        error: "Benachrichtigungen für Empfänger deaktiviert.",
      });
      results.push({ eventId: row.id, status: "skipped", error: "Benachrichtigungen deaktiviert." });
      continue;
    }

    if (recipient && preferences.get(`${recipient.id}:${row.type}`) === false) {
      await insertDeliveryRows(supabase, [{ row, target, payload: deliveryEvent }], "failed", 0, {
        error: "Google-Chat-Präferenz für diesen Event-Typ deaktiviert.",
      });
      results.push({ eventId: row.id, status: "skipped", error: "Google-Chat-Präferenz deaktiviert." });
      continue;
    }

    deliverableRows.push({ row, target, payload: deliveryEvent });
  }

  if (!deliverableRows.length) {
    return NextResponse.json({ ok: true, sent: 0, failed: 0, skipped: results.length, results });
  }

  const appUrl = appUrlFromRequest(request);
  const deliveredAt = new Date().toISOString();
  const directDmRows = deliveryStatus.apiConfigured
    ? deliverableRows.filter(({ target }) => isGoogleChatDmSpace(target))
    : [];
  const webhookRows = deliveryStatus.webhookConfigured
    ? deliverableRows.filter(({ target }) => !deliveryStatus.apiConfigured || !isGoogleChatDmSpace(target))
    : [];
  const undeliverableRows = deliverableRows.filter(({ target }) =>
    deliveryStatus.apiConfigured && !deliveryStatus.webhookConfigured && !isGoogleChatDmSpace(target),
  );

  if (undeliverableRows.length) {
    const error = "Kein Google-Chat-DM-Space im Profil hinterlegt.";
    await insertDeliveryRows(supabase, undeliverableRows, "failed", 0, { error });
    results.push(...undeliverableRows.map(({ row }) => ({ eventId: row.id, status: "failed" as const, error })));
  }

  if (directDmRows.length) {
    const rowsBySpace = new Map<string, DeliveryRow[]>();
    for (const row of directDmRows) rowsBySpace.set(row.target, [...(rowsBySpace.get(row.target) || []), row]);

    for (const [target, rows] of rowsBySpace) {
      try {
        await sendGoogleChatSpaceDigest(target, rows.map(({ payload }) => payload), appUrl);
        await insertDeliveryRows(supabase, rows, "sent", 1, {
          deliveredAt,
          deliveryMode: "direct_dm",
          digestSize: rows.length,
        });
        results.push(...rows.map(({ row }) => ({ eventId: row.id, status: "sent" as const })));
      } catch (error) {
        const message = error instanceof Error ? error.message : "Google Chat DM-Versand fehlgeschlagen.";
        await insertDeliveryRows(supabase, rows, "failed", 1, { error: message, deliveryMode: "direct_dm" });
        results.push(...rows.map(({ row }) => ({ eventId: row.id, status: "failed" as const, error: message })));
      }
    }
  }

  if (webhookRows.length) {
    try {
      await sendGoogleChatDigest(webhookRows.map(({ payload }) => payload), appUrl);
      await insertDeliveryRows(supabase, webhookRows, "sent", 1, {
        deliveredAt,
        deliveryMode: "webhook_digest",
        digestSize: webhookRows.length,
      });
      results.push(...webhookRows.map(({ row }) => ({ eventId: row.id, status: "sent" as const })));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Google Chat Versand fehlgeschlagen.";
      await insertDeliveryRows(supabase, webhookRows, "failed", 1, { error: message, deliveryMode: "webhook_digest" });
      results.push(...webhookRows.map(({ row }) => ({ eventId: row.id, status: "failed" as const, error: message })));
    }
  }

  const sent = results.filter((result) => result.status === "sent").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;

  if (failed && !sent) {
    const errorMessage = results.find((result) => result.error)?.error || "Google Chat Versand fehlgeschlagen.";
    return NextResponse.json({ error: errorMessage, sent, failed, skipped, results }, { status: statusCodeForError(errorMessage) });
  }

  return NextResponse.json({ ok: true, sent, failed, skipped, results, googleChat: deliveryStatus });
}
