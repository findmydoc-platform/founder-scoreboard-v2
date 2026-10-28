import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPlanningItemsForReadModel, mapPlanningProject, planningProjectId } from "@/features/planning-items/server/planning-workspace-read-source";
import type { ProfileReadModel } from "@/features/profile/model/profile-read-model";
import { mapNotificationPreference, mapProfileUiPreference } from "@/lib/planning-row-mappers";
import type { DbNotificationPreference, DbProfileUiPreference } from "@/lib/planning-row-types";

export function createSupabaseProfileReadModel(supabase: SupabaseClient): ProfileReadModel {
  return {
    async load(context) {
      if (!context.authorized) return { status: "forbidden" };
      const [state, projectResult, notificationPreferenceResult, preferenceResult] = await Promise.all([
        loadPlanningItemsForReadModel(supabase),
        supabase.from("projects").select("id,name,range_label,review_objection_window_hours").eq("id", planningProjectId).single(),
        supabase.from("notification_preferences").select("id,profile_id,channel,event_type,enabled", { count: "exact" }).eq("channel", "google_chat").order("profile_id"),
        supabase.from("profile_ui_preferences").select("profile_id,default_workspace,default_task_view,planning_filters,expanded_item_ids,created_at,updated_at", { count: "exact" }).order("profile_id"),
      ]);
      if (!state || projectResult.error || !projectResult.data || notificationPreferenceResult.error || preferenceResult.error) return { status: "unavailable" };
      const complete = (result: { data: unknown[] | null; count: number | null }) => typeof result.count === "number" && (result.data?.length || 0) >= result.count ? "complete" as const : "partial" as const;
      const preferences = ((preferenceResult.data || []) as DbProfileUiPreference[]).map(mapProfileUiPreference);
      return {
        status: "ready",
        model: {
          revision: preferences.reduce((latest, preference) => preference.updatedAt > latest ? preference.updatedAt : latest, ""),
          readCoverage: { project: "complete", people: state.readCoverage.people, initiatives: state.readCoverage.items, strategies: state.readCoverage.strategies, raci: state.readCoverage.raci, links: state.readCoverage.links, notificationPreferences: complete(notificationPreferenceResult), preferences: complete(preferenceResult) },
          project: mapPlanningProject(projectResult.data),
          people: state.people,
          initiatives: state.items.filter((item) => item.taskType === "initiative"),
          notificationPreferences: ((notificationPreferenceResult.data || []) as DbNotificationPreference[]).map(mapNotificationPreference),
          preferences,
        },
      };
    },
  };
}
