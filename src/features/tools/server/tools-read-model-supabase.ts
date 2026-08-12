import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { planningProfileSelect } from "@/features/planning-items/server/planning-workspace-read-source";
import type { ToolsReadModel } from "@/features/tools/model/tools-read-model";
import { mapFmdTool } from "@/lib/planning-data-mappers";
import type { DbFmdTool, DbProfile } from "@/lib/planning-data-row-types";
import { mapProfile } from "@/lib/planning-profile-mappers";

export function createSupabaseToolsReadModel(supabase: SupabaseClient): ToolsReadModel {
  return {
    async load(context) {
      if (!context.authorized) return { status: "forbidden" };
      const [profileResult, toolResult] = await Promise.all([
        supabase.from("profiles").select(planningProfileSelect).order("name"),
        supabase.from("fmd_tools").select("id,name,category,kind,description,url,owner,status,is_curated,preview_image_url,preview_image_source,sort_order").order("sort_order"),
      ]);
      if (profileResult.error || toolResult.error) return { status: "unavailable" };
      const tools = ((toolResult.data || []) as DbFmdTool[]).map(mapFmdTool);
      return {
        status: "ready",
        model: {
          revision: tools.map((tool) => `${tool.sortOrder}:${tool.id}`).join("|"),
          tools,
          people: ((profileResult.data || []) as DbProfile[]).map(mapProfile),
        },
      };
    },
  };
}
