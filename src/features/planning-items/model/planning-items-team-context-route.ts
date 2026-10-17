import type { NextRequest } from "next/server";
import {
  handlePlanningItemsRequest,
  planningItemsJson,
} from "@/features/planning-items/model/planning-items-route";

export async function handleTeamPlanningItemsContext(
  request: NextRequest,
) {
  return handlePlanningItemsRequest(
    request,
    {
      operation: "planningContext.read",
      mode: "read",
    },
    "Planning-Kontext konnte nicht geladen werden.",
    async (permission) => {
      const context = await permission.planningItems.readContext();
      return planningItemsJson({
        ok: true,
        context,
      });
    },
  );
}
