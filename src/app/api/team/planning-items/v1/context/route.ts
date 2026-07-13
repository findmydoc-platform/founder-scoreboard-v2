import type { NextRequest } from "next/server";
import { buildPlanningItemsContext } from "@/features/planning-items/model/planning-items-context";
import { handlePlanningItemsRequest, planningItemsJson } from "@/features/planning-items/model/planning-items-route";

export async function GET(request: NextRequest) {
  return handlePlanningItemsRequest(request, "read:planning-context", "Planning-Kontext konnte nicht geladen werden.", async (permission) => {
    const context = await buildPlanningItemsContext(permission.supabase, permission.profile);
    return planningItemsJson({ ok: true, context });
  });
}
