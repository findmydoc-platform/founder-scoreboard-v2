import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPlanningItemsForReadModel, mapPlanningProject, planningProjectId } from "@/features/planning-items/server/planning-workspace-read-source";
import type { ProfileReadModel } from "@/features/profile/model/profile-read-model";
import { mapNotificationPreference, mapProfileUiPreference } from "@/lib/planning-data-mappers";
import type { DbNotificationPreference, DbProfileUiPreference } from "@/lib/planning-data-row-types";

export function createSupabaseProfileReadModel(supabase: SupabaseClient): ProfileReadModel {
  return {
    async load(context) {
      if (!context.authorized) return { status: "forbidden" };
      const [state, projectResult, notificationPreferenceResult, preferenceResult] = await Promise.all([
        loadPlanningItemsForReadModel(supabase),
        supabase.from("projects").select("id,name,range_label,review_objection_window_hours,github_project_owner,github_project_number").eq("id", planningProjectId).single(),
        supabase.from("notification_preferences").select("id,profile_id,channel,event_type,enabled").eq("channel", "google_chat").order("profile_id"),
        supabase.from("profile_ui_preferences").select("profile_id,default_workspace,default_task_view,planning_filters,expanded_package_ids,created_at,updated_at").order("profile_id"),
      ]);
      if (!state || projectResult.error || !projectResult.data || notificationPreferenceResult.error || preferenceResult.error) return { status: "unavailable" };
      const preferences = ((preferenceResult.data || []) as DbProfileUiPreference[]).map(mapProfileUiPreference);
      return {
        status: "ready",
        model: {
          revision: preferences.reduce((latest, preference) => preference.updatedAt > latest ? preference.updatedAt : latest, ""),
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
