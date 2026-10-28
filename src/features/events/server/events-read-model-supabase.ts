import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { EventRange } from "../model/event-state";
import type { EventsReadModel } from "@/features/events/model/events-read-model";
import { planningProfileSelect } from "@/features/planning-items/server/planning-workspace-read-source";
import { mapFounderEvent } from "@/lib/planning-row-mappers";
import type { DbFounderEvent, DbProfile } from "@/lib/planning-row-types";
import { mapProfile } from "@/lib/planning-profile-mappers";

export function createSupabaseEventsReadModel(supabase: SupabaseClient, range: EventRange | null = null): EventsReadModel {
  return {
    async load(context) {
      if (!context.authorized) return { status: "forbidden" };
      let query = supabase.from("founder_events").select("id,title,category,starts_at,ends_at,location,description,audience_mode,participant_profile_ids,reminder_days_before,reminder_generated_at,status,created_by,created_at,updated_at").order("starts_at", { ascending: true }).limit(200);
      if (range) query = query.gte("starts_at", range.from).lt("starts_at", range.to);
      const [profileResult, eventResult] = await Promise.all([
        supabase.from("profiles").select(planningProfileSelect).order("name"),
        query,
      ]);
      if (profileResult.error || eventResult.error) return { status: "unavailable" };
      const events = ((eventResult.data || []) as DbFounderEvent[]).map(mapFounderEvent);
      return {
        status: "ready",
        model: {
          revision: events.reduce((latest, event) => event.updatedAt > latest ? event.updatedAt : latest, ""),
          events,
          coverage: { range, completeness: events.length < 200 ? "complete" : "partial" },
          people: ((profileResult.data || []) as DbProfile[]).map(mapProfile),
        },
      };
    },
  };
}
