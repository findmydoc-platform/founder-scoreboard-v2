import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationsReadModel } from "@/features/notifications/model/notifications-read-model";
import { loadPlanningItemsForReadModel } from "@/features/planning-items/server/planning-workspace-read-source";
import { readPlanningNotificationTargets } from "@/features/planning-items/server/planning-notification-targets";
import { mapNotificationDelivery, mapNotificationEvent } from "@/lib/planning-row-mappers";
import type { DbNotificationDelivery, DbNotificationEvent } from "@/lib/planning-row-types";
import { isOperationalLeadRole } from "@/lib/platform";
import { headerNotificationSelect, maxHeaderNotifications, projectHeaderNotifications } from "@/lib/planning-header-data";
import { notificationLeadRecipientFilter, quoteNotificationFilterValue } from "@/lib/notification-recipient-filter";

function validPageRows(rows: unknown, maxRows: number): rows is DbNotificationEvent[] {
  return Array.isArray(rows) && rows.length <= maxRows && rows.every(row =>
    row && Number.isSafeInteger(row.id) && row.id > 0
    && typeof row.created_at === "string" && Number.isFinite(Date.parse(row.created_at))
    && typeof row.type === "string" && typeof row.title === "string"
    && typeof row.entity_type === "string" && typeof row.entity_id === "string"
    && ["pending", "sent", "failed", "resolved", "dismissed"].includes(row.status));
}

export function projectNotificationPreview(rows: unknown, context: Parameters<NotificationsReadModel["loadPreview"]>[0]): Awaited<ReturnType<NotificationsReadModel["loadPreview"]>> {
  if (!context.authorized || !context.actorProfileId || !context.platformRole) return { status: "forbidden" };
  if (context.signal?.aborted || !validPageRows(rows, maxHeaderNotifications)) return { status: "unavailable" };
  return { status: "ready", items: projectHeaderNotifications(rows.map(mapNotificationEvent), context.actorProfileId, context.platformRole).items };
}

export async function hydrateNotificationInbox(supabase: SupabaseClient, selected: unknown, context: Parameters<NotificationsReadModel["loadInbox"]>[0]): ReturnType<NotificationsReadModel["loadInbox"]> {
  if (!context.authorized || !context.actorProfileId || !context.platformRole) return { status: "forbidden" };
  if (context.signal?.aborted || !validPageRows(selected, context.limit + 1)) return { status: "unavailable" };
  const rows = selected.slice(0, context.limit);
  const events = rows.map(mapNotificationEvent);
  const more = selected.length > context.limit;
  const last = rows.at(-1);
  const targets = events.filter(event => ["task", "initiative"].includes(event.entityType.trim().toLowerCase()));
  const ids = [...new Set(targets.map(event => event.entityId).filter(id => id.trim()))];
  let references: import("../model/notifications-read-model").NotificationInboxReference[] = [];
  let referenceCoverage: "complete" | "partial" | "unavailable" = targets.some(event => !event.entityId.trim()) ? "partial" : "complete";
  if (ids.length) {
    const loaded = await readPlanningNotificationTargets(supabase, ids, context.signal);
    if (loaded.status !== "ready") {
      if (loaded.status === "forbidden") return { status: "forbidden" };
      referenceCoverage = "unavailable";
    } else {
      references = loaded.references;
      if (new Set(references.map(reference => reference.itemId)).size !== ids.length) referenceCoverage = "partial";
    }
  }
  return { status: "ready", events, coverage: more ? "partial" : "complete", next: more && last ? { createdAt: last.created_at, id: last.id } : null, references, referenceCoverage };
}

export function createSupabaseNotificationsReadModel(supabase: SupabaseClient): NotificationsReadModel {
  return {
    async loadInbox(context) {
      if (!context.authorized || !context.actorProfileId || !context.platformRole) return { status: "forbidden" };
      if (context.signal?.aborted || !Number.isSafeInteger(context.limit) || context.limit < 1 || context.limit > 100) return { status: "unavailable" };
      const position = context.position;
      if (position && (!Number.isSafeInteger(position.id) || position.id < 1 || !Number.isFinite(Date.parse(position.createdAt)))) return { status: "unavailable" };
      let query = supabase.from("notification_events").select("id,type,actor_profile_id,actor_label,recipient_profile_id,entity_type,entity_id,title,body,target_path,status,seen_at,dismissed_at,resolved_at,resolution_reason,created_at")
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(context.limit + 1);
      const actor = `recipient_profile_id.eq.${quoteNotificationFilterValue(context.actorProfileId)}`;
      const cursor = position ? `created_at.lt.${quoteNotificationFilterValue(position.createdAt)},and(created_at.eq.${quoteNotificationFilterValue(position.createdAt)},id.lt.${position.id})` : null;
      if (isOperationalLeadRole(context.platformRole)) query = query.or(cursor ? `and(${actor},or(${cursor})),and(recipient_profile_id.is.null,or(${cursor}))` : notificationLeadRecipientFilter(context.actorProfileId));
      else { query = query.eq("recipient_profile_id", context.actorProfileId); if (cursor) query = query.or(cursor); }
      if (context.signal) query = query.abortSignal(context.signal);
      const result = await query;
      if (result.error) return { status: result.status === 401 || result.status === 403 ? "forbidden" : "unavailable" };
      return hydrateNotificationInbox(supabase, result.data, context);
    },
    async loadUnreadCount(context) {
      if (!context.authorized || !context.actorProfileId || !context.platformRole) return { status: "forbidden" };
      if (context.signal?.aborted) return { status: "unavailable" };
      let query = supabase.from("notification_events").select("id", { count: "exact", head: true }).eq("status", "pending").is("seen_at", null);
      query = isOperationalLeadRole(context.platformRole)
        ? query.or(notificationLeadRecipientFilter(context.actorProfileId))
        : query.eq("recipient_profile_id", context.actorProfileId);
      if (context.signal) query = query.abortSignal(context.signal);
      const result = await query;
      if (result.error) return { status: result.status === 401 || result.status === 403 ? "forbidden" : "unavailable" };
      if (!Number.isSafeInteger(result.count) || result.count === null || result.count < 0) return { status: "unavailable" };
      return { status: "ready", unreadCount: result.count };
    },
    async loadPreview(context) {
      if (!context.authorized || !context.actorProfileId || !context.platformRole) return { status: "forbidden" };
      if (context.signal?.aborted) return { status: "unavailable" };
      let query = supabase.from("notification_events").select(`${headerNotificationSelect},status,seen_at`)
        .eq("status", "pending").is("seen_at", null).order("created_at", { ascending: false }).order("id", { ascending: false }).limit(maxHeaderNotifications);
      query = isOperationalLeadRole(context.platformRole)
        ? query.or(notificationLeadRecipientFilter(context.actorProfileId))
        : query.eq("recipient_profile_id", context.actorProfileId);
      if (context.signal) query = query.abortSignal(context.signal);
      const result = await query;
      if (result.error) return { status: result.status === 401 || result.status === 403 ? "forbidden" : "unavailable" };
      return projectNotificationPreview(result.data, context);
    },
    async load(context) {
      if (!context.authorized) return { status: "forbidden" };
      const [state, eventResult, deliveryResult] = await Promise.all([
        loadPlanningItemsForReadModel(supabase),
        supabase.from("notification_events").select("id,type,actor_profile_id,actor_label,recipient_profile_id,entity_type,entity_id,title,body,target_path,status,seen_at,dismissed_at,resolved_at,resolution_reason,created_at").order("created_at", { ascending: false }).limit(500),
        supabase.from("notification_deliveries").select("id,event_id,channel,status,attempts,target,payload,last_error,delivered_at,created_at").order("created_at", { ascending: false }).limit(100),
      ]);
      if (!state || eventResult.error || deliveryResult.error) return { status: "unavailable" };
      const actor = context.actorProfileId ? state.people.find((profile) => profile.id === context.actorProfileId) : null;
      const operationalLead = Boolean(actor && isOperationalLeadRole(actor.platformRole));
      const events = ((eventResult.data || []) as DbNotificationEvent[])
        .map(mapNotificationEvent)
        .filter((event) => !context.actorProfileId || event.recipientProfileId === context.actorProfileId || !event.recipientProfileId && operationalLead);
      return {
        status: "ready",
        model: {
          revision: events.reduce((latest, event) => event.createdAt > latest ? event.createdAt : latest, ""),
          coverage: { events: (eventResult.data?.length || 0) < 500 ? "complete" : "partial", deliveries: !operationalLead ? "forbidden" : (deliveryResult.data?.length || 0) < 100 ? "complete" : "partial" },
          readCoverage: state.readCoverage,
          people: state.people,
          items: state.items,
          events,
          deliveries: operationalLead
            ? ((deliveryResult.data || []) as DbNotificationDelivery[]).map(mapNotificationDelivery)
            : [],
        },
      };
    },
  };
}
