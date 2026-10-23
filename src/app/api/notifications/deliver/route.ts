import { observeRuntimeHandler, observeRuntimePreparation } from "@/lib/runtime-logging";
import { NextResponse, type NextRequest } from "next/server";
import { apiError, authzError, supabaseUnavailable } from "@/lib/api-response";
import { authorizeCredentialAction } from "@/lib/credentials";
import {
  googleChatDeliveryStatus,
  isGoogleChatDmSpace,
  formatGoogleChatDigestCard,
  type GoogleChatDigestEvent,
} from "@/lib/google-chat";
import { shouldSendToGoogleChatDigest, shouldSendToGoogleChatDm } from "@/lib/notification-policy";
import type { NotificationDeliveryRow as NotificationRow, NotificationDeliveryProfile as ProfileRow, NotificationDeliveryPreference as PreferenceRow, DeliveryRecordRow as DeliveryRow } from "@/lib/credentials/notification-delivery-types";

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

async function inspect(request: NextRequest) {
  const permission = await authorizeCredentialAction({credential:{kind:"notification-delivery-request",request},action:"notifications.delivery.inspect"});
  if (!permission.ok) return permission.status === 501 ? supabaseUnavailable() : authzError(permission);
  if (!permission.inspection) return apiError("Keine Berechtigung für diese Aktion.",403);
  const {count,error} = await permission.inspection.pending();
  if (error) return apiError("Zustellstatus konnte nicht geladen werden.",500);

  const status = await googleChatDeliveryStatus();
  return observeRuntimePreparation(() => NextResponse.json({
    ok: true,
    googleChat: status,
    googleChatConfigured: status.webhookConfigured || status.apiConfigured,
    pending: count || 0,
  }));
}

async function deliver(request: NextRequest) {
  const payload = (await request.json().catch(() => ({}))) as Record<string,unknown>;
  const permission = await authorizeCredentialAction({credential:{kind:"notification-delivery-request",request},action:"notifications.delivery.run",selection:payload});
  if (!permission.ok) return permission.status === 501 ? supabaseUnavailable() : authzError(permission);
  if (!permission.delivery) return apiError("Keine Berechtigung für diese Aktion.",403);
  const deliveryStatus = await googleChatDeliveryStatus();

  if (!deliveryStatus.ready) {
    const missing = deliveryStatus.webhookConfigured || deliveryStatus.apiConfigured
      ? "GOOGLE_CHAT_DELIVERY_ENABLED ist nicht auf true gesetzt."
      : "GOOGLE_CHAT_WEBHOOK_URL oder Google-Chat-Service-Account ist nicht gesetzt.";
    return observeRuntimePreparation(() => NextResponse.json({
      error: missing,
      sent: 0,
      failed: 0,
      skipped: 0,
      googleChat: deliveryStatus,
    }, { status: 424 }));
  }

  await permission.delivery.reconcile();
  const reservation = await permission.delivery.reserve();
  if (!reservation.ok) return authzError(reservation);
  const claim = reservation.claim;
  if (!claim) return observeRuntimePreparation(() => NextResponse.json({ok:true,sent:0,failed:0,skipped:0,results:[]}));
  const loaded = await claim.load();
  if (!loaded.ok) { await claim.release(); return apiError("Zustelldaten konnten nicht geladen werden.",500); }
  const {events,existingDeliveries} = loaded;
  if (!events.length) { await claim.release(); return observeRuntimePreparation(() => NextResponse.json({ok:true,sent:0,failed:0,skipped:0,results:[]})); }
  const alreadyDelivered = new Set(
    (existingDeliveries || [])
      .filter((delivery: { event_id: number; status: string }) => delivery.status === "sent")
      .map((delivery: { event_id: number }) => delivery.event_id),
  );

  const profiles = new Map(loaded.profiles.map((profile: ProfileRow) => [profile.id, profile]));
  const preferences = new Map(
    loaded.preferences.map((preference: PreferenceRow) => [`${preference.profile_id}:${preference.event_type}`, preference.enabled]),
  );
  const results: Array<{ eventId: number; status: "sent" | "failed" | "skipped"; error?: string }> = [];
  const deliverableRows: DeliveryRow[] = [];

  for (const row of events as NotificationRow[]) {
    const actor = row.actor_profile_id ? profiles.get(row.actor_profile_id) : null;
    const recipient = row.recipient_profile_id ? profiles.get(row.recipient_profile_id) : null;
    const target = recipient?.google_chat_dm_space || "founder-ops-space";
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
      results.push({ eventId: row.id, status: "skipped", error: "Bereits in der Sammelmeldung gesendet." });
      continue;
    }

    if (!shouldSendToGoogleChatDigest(row.type)) {
      results.push({ eventId: row.id, status: "skipped", error: "Nur In-App-Benachrichtigung." });
      continue;
    }

    if (recipient?.notifications_enabled === false) {
      await claim.record( [{ row, target, payload: deliveryEvent }], "failed", 0, {
        error: "Benachrichtigungen für Empfänger deaktiviert.",
      });
      results.push({ eventId: row.id, status: "skipped", error: "Benachrichtigungen deaktiviert." });
      continue;
    }

    if (recipient && preferences.get(`${recipient.id}:${row.type}`) === false) {
      await claim.record( [{ row, target, payload: deliveryEvent }], "failed", 0, {
        error: "Google-Chat-Präferenz für diesen Event-Typ deaktiviert.",
      });
      results.push({ eventId: row.id, status: "skipped", error: "Google-Chat-Präferenz deaktiviert." });
      continue;
    }

    deliverableRows.push({ row, target, payload: deliveryEvent });
  }

  if (!deliverableRows.length) {
    await claim.finalize();
    return observeRuntimePreparation(() => NextResponse.json({ ok: true, sent: 0, failed: 0, skipped: results.length, results }));
  }

  const appUrl = appUrlFromRequest(request);
  const deliveredAt = new Date().toISOString();
  const directDmCandidateRows = deliverableRows.filter(({ row }) =>
    Boolean(row.recipient_profile_id) && shouldSendToGoogleChatDm(row.type),
  );
  const directDmRows = deliveryStatus.apiConfigured
    ? directDmCandidateRows.filter(({ target }) => isGoogleChatDmSpace(target))
    : [];
  const undeliverableDmRows = directDmCandidateRows.filter(({ target }) =>
    !deliveryStatus.apiConfigured || !isGoogleChatDmSpace(target),
  );
  const webhookRows = deliveryStatus.webhookConfigured
    ? deliverableRows.filter(({ row }) => !row.recipient_profile_id || !shouldSendToGoogleChatDm(row.type))
    : [];
  const undeliverableWebhookRows = deliverableRows.filter(({ row }) =>
    !row.recipient_profile_id && !deliveryStatus.webhookConfigured,
  );

  if (undeliverableDmRows.length) {
    const error = deliveryStatus.apiConfigured
      ? "Kein gültiger Google-Chat-DM-Space im Empfängerprofil hinterlegt; persönliche Action-Items werden nicht in den Gruppenchat umgeleitet."
      : "Google-Chat-API ist für persönliche DMs nicht konfiguriert.";
    await claim.record( undeliverableDmRows, "failed", 0, { error, deliveryMode: "direct_dm" });
    results.push(...undeliverableDmRows.map(({ row }) => ({ eventId: row.id, status: "failed" as const, error })));
  }

  if (undeliverableWebhookRows.length) {
    const error = "GOOGLE_CHAT_WEBHOOK_URL ist nicht gesetzt.";
    await claim.record( undeliverableWebhookRows, "failed", 0, { error, deliveryMode: "webhook_digest" });
    results.push(...undeliverableWebhookRows.map(({ row }) => ({ eventId: row.id, status: "failed" as const, error })));
  }

  let admissionFailureStatus: number | undefined;
  let admissionFailureCode: string | undefined;
  async function deliverBatch(mode: "direct_dm" | "webhook_digest", target: string, rows: DeliveryRow[]) {
    try {
      await claim!.send(mode,target,rows.map(({row}) => row.id),formatGoogleChatDigestCard(rows.map(({payload}) => payload),appUrl));
    } catch (error) {
      if (error && typeof error === "object" && "status" in error && typeof error.status === "number") admissionFailureStatus = error.status;
      if (error && typeof error === "object" && "code" in error && typeof error.code === "string") admissionFailureCode = error.code;
      const message = error instanceof Error ? error.message : "Google Chat Versand fehlgeschlagen.";
      await claim!.record(rows,"failed",1,{error:message,deliveryMode:mode});
      results.push(...rows.map(({row}) => ({eventId:row.id,status:"failed" as const,error:message})));
      return;
    }
    await claim!.record(rows,"sent",1,{deliveredAt,deliveryMode:mode,digestSize:rows.length});
    results.push(...rows.map(({row}) => ({eventId:row.id,status:"sent" as const})));
  }
  if (directDmRows.length) {
    const rowsBySpace = new Map<string, DeliveryRow[]>();
    for (const row of directDmRows) rowsBySpace.set(row.target, [...(rowsBySpace.get(row.target) || []), row]);
    for (const [target, rows] of rowsBySpace) await deliverBatch("direct_dm",target,rows);
  }
  if (webhookRows.length) await deliverBatch("webhook_digest","founder-ops-space",webhookRows);

  const sent = results.filter((result) => result.status === "sent").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const skipped = results.filter((result) => result.status === "skipped").length;

  await claim.finalize();

  if (failed && !sent) {
    const errorMessage = results.find((result) => result.error)?.error || "Google Chat Versand fehlgeschlagen.";
    return observeRuntimePreparation(() => NextResponse.json({ error: errorMessage, sent, failed, skipped, results, ...(admissionFailureCode ? {code:admissionFailureCode}:{}) }, { status: admissionFailureStatus || statusCodeForError(errorMessage) }));
  }

  return observeRuntimePreparation(() => NextResponse.json({ ok: true, sent, failed, skipped, results, googleChat: deliveryStatus }));
}

async function handlePOST(request:NextRequest) {
  try { return await deliver(request); }
  catch (error) {
    if (error && typeof error === "object" && "status" in error && typeof error.status === "number" && error instanceof Error) {
      const status = error.status;
      return observeRuntimePreparation(() => NextResponse.json({error:error.message,...("code" in error && error.code ? {code:error.code}:{})},{status}));
    }
    return apiError("Zustellauftrag konnte nicht abgeschlossen werden.",500);
  }
}

async function handleGET(request:NextRequest) {
  try { return await inspect(request); }
  catch (error) {
    if (error instanceof Error && "status" in error && typeof error.status === "number") {
      const status = error.status;
      return observeRuntimePreparation(() => NextResponse.json({error:error.message,...("code" in error && error.code ? {code:error.code}:{})},{status}));
    }
    return apiError("Zustellstatus konnte nicht geladen werden.",500);
  }
}

export const GET = observeRuntimeHandler("notifications.delivery.inspect", handleGET);

export const POST = observeRuntimeHandler("notifications.delivery.run", handlePOST);
