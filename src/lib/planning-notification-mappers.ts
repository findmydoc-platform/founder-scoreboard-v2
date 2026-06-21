import type { FeedbackItem, FmdTool, FounderEvent, NotificationDelivery, NotificationEvent, NotificationPreference } from "./types";
import type { DbFeedbackItem, DbFmdTool, DbFounderEvent, DbNotificationDelivery, DbNotificationEvent, DbNotificationPreference } from "./planning-data-row-types";

export function mapNotificationEvent(row: DbNotificationEvent): NotificationEvent {
  return {
    id: row.id,
    type: row.type,
    actorProfileId: row.actor_profile_id || "",
    recipientProfileId: row.recipient_profile_id || "",
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: row.title,
    body: row.body || "",
    status: row.status,
    createdAt: row.created_at,
  };
}

export function mapNotificationDelivery(row: DbNotificationDelivery): NotificationDelivery {
  const payload = row.payload && typeof row.payload === "object" ? row.payload : null;
  return {
    id: row.id,
    eventId: row.event_id,
    channel: row.channel,
    status: row.status,
    attempts: row.attempts,
    target: row.target || "",
    lastError: row.last_error || "",
    deliveryMode: payload?.deliveryMode || "",
    digestSize: Number(payload?.digestSize || 0),
    deliveredAt: row.delivered_at || "",
    createdAt: row.created_at,
  };
}

export function mapNotificationPreference(row: DbNotificationPreference): NotificationPreference {
  return {
    id: row.id,
    profileId: row.profile_id,
    channel: row.channel,
    eventType: row.event_type,
    enabled: row.enabled,
  };
}

export function mapFeedbackItem(row: DbFeedbackItem): FeedbackItem {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    severity: row.severity,
    profileId: row.profile_id || "",
    title: row.title,
    description: row.description,
    pageUrl: row.page_url || "",
    createdAt: row.created_at,
  };
}

export function mapFmdTool(row: DbFmdTool): FmdTool {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    kind: row.kind,
    description: row.description || "",
    url: row.url || "",
    owner: row.owner || "",
    status: row.status,
    sortOrder: row.sort_order,
  };
}

export function mapFounderEvent(row: DbFounderEvent): FounderEvent {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    startsAt: row.starts_at,
    endsAt: row.ends_at || row.starts_at,
    location: row.location || "",
    description: row.description || "",
    audienceMode: row.audience_mode,
    participantProfileIds: row.participant_profile_ids || [],
    reminderDaysBefore: row.reminder_days_before,
    reminderGeneratedAt: row.reminder_generated_at || "",
    status: row.status,
    createdBy: row.created_by || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
