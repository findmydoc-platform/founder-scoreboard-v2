import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadPlanningItemsForReadModel } from "@/features/planning-items/server/planning-workspace-read-source";
import type { TeamReadModel } from "@/features/team/model/team-read-model";

export function createSupabaseTeamReadModel(supabase: SupabaseClient): TeamReadModel {
  return {
    async load(context) {
      if (!context.authorized) return { status: "forbidden" };
      const state = await loadPlanningItemsForReadModel(supabase);
      if (!state) return { status: "unavailable" };
      return {
        status: "ready",
        model: {
          revision: state.items.reduce<string>((latest, item) => item.updatedAt && item.updatedAt > latest ? item.updatedAt : latest, ""),
          people: state.people,
          items: state.items,
        },
      };
    },
  };
}
