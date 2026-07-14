import type { NextRequest } from "next/server";
import {
  loadPlanningItemMilestoneDeletePreview,
  parsePlanningItemDeletePayload,
} from "@/features/planning-items/model/planning-item-delete";
import {
  handlePlanningItemsRequest,
  planningItemsError,
  planningItemsJson,
} from "@/features/planning-items/model/planning-items-route";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handlePlanningItemsRequest(
    request,
    "write:planning-items:delete-empty",
    "Planning-Items-Löschung konnte nicht geprüft werden.",
    async (permission) => {
      const { id } = await context.params;
      const itemId = id.trim();
      if (!itemId) return planningItemsError("Planungselement-ID ist erforderlich.", 400);

      const parsed = parsePlanningItemDeletePayload(await request.json().catch(() => null));
      if (!parsed.ok) return planningItemsError(parsed.error, 400);

      const result = await loadPlanningItemMilestoneDeletePreview({
        actor: permission.profile,
        itemId,
        expectedUpdatedAt: parsed.expectedUpdatedAt,
        supabase: permission.supabase,
      });
      if (!result.ok) return planningItemsError(result.error, result.status);

      return planningItemsJson({
        ok: true,
        ...result.preview,
      });
    },
  );
}
