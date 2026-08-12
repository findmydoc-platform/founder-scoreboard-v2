import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { NotificationsReadModel } from "@/features/notifications/model/notifications-read-model";
import { loadPlanningItemsForReadModel } from "@/features/planning-items/server/planning-workspace-read-source";
import { mapNotificationDelivery, mapNotificationEvent } from "@/lib/planning-row-mappers";
import type { DbNotificationDelivery, DbNotificationEvent } from "@/lib/planning-row-types";
import { isOperationalLeadRole } from "@/lib/platform";

export function createSupabaseNotificationsReadModel(supabase: SupabaseClient): NotificationsReadModel {
  return {
    async load(context) {
      if (!context.authorized) return { status: "forbidden" };
      const [state, eventResult, deliveryResult] = await Promise.all([
        loadPlanningItemsForReadModel(supabase),
        supabase.from("notification_events").select("id,type,actor_profile_id,recipient_profile_id,entity_type,entity_id,title,body,status,seen_at,dismissed_at,resolved_at,resolution_reason,created_at").order("created_at", { ascending: false }).limit(500),
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
