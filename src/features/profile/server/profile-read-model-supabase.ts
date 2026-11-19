import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { planningProfileSelect, mapPlanningProject, planningProjectId } from "@/features/planning-items/server/planning-workspace-read-source";
import type { ProfileReadModel } from "@/features/profile/model/profile-read-model";
import { mapNotificationPreference, mapProfileUiPreference } from "@/lib/planning-row-mappers";
import { mapProfile } from "@/lib/planning-profile-mappers";
import type { DbNotificationPreference, DbProfileUiPreference, DbProfile } from "@/lib/planning-row-types";

export function createSupabaseProfileReadModel(supabase: SupabaseClient): ProfileReadModel {
  return {
    async load(context) {
      if (!context.authorized) return { status: "forbidden" };
      const [profileResult, projectResult, notificationPreferenceResult, preferenceResult] = await Promise.all([
        supabase.from("profiles").select(planningProfileSelect, { count: "exact" }).order("name"),
        supabase.from("projects").select("id,name,range_label,review_objection_window_hours").eq("id", planningProjectId).single(),
        supabase.from("notification_preferences").select("id,profile_id,channel,event_type,enabled", { count: "exact" }).eq("channel", "google_chat").order("profile_id"),
        supabase.from("profile_ui_preferences").select("profile_id,default_workspace,default_task_view,planning_filters,expanded_item_ids,created_at,updated_at", { count: "exact" }).order("profile_id"),
      ]);
      if (profileResult.error || !Array.isArray(profileResult.data) || projectResult.error || !projectResult.data || notificationPreferenceResult.error || preferenceResult.error) return { status: "unavailable" };
      const complete = (result: { data: unknown[] | null; count: number | null }) => typeof result.count === "number" && (result.data?.length || 0) >= result.count ? "complete" as const : "partial" as const;
      const preferences = ((preferenceResult.data || []) as DbProfileUiPreference[]).map(mapProfileUiPreference);
      return {
        status: "ready",
        model: {
          revision: preferences.reduce((latest, preference) => preference.updatedAt > latest ? preference.updatedAt : latest, ""),
          readCoverage: { project: "complete", people: complete(profileResult), initiatives: "partial", strategies: "partial", raci: "partial", links: "partial", notificationPreferences: complete(notificationPreferenceResult), preferences: complete(preferenceResult) },
          project: mapPlanningProject(projectResult.data),
          people: (profileResult.data as DbProfile[]).map(mapProfile),
          initiatives: [],
          notificationPreferences: ((notificationPreferenceResult.data || []) as DbNotificationPreference[]).map(mapNotificationPreference),
          preferences,
        },
      };
    },
  };
}
