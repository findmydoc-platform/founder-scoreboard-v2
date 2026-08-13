import type { NextRequest } from "next/server";
import {
  buildPlanningItemsContext,
  planningItemsV2Context,
} from "@/features/planning-items/model/planning-items-context";
import type { TeamPlanningItemsApiContract } from "@/features/planning-items/model/planning-items-team-api-contract";
import {
  handlePlanningItemsRequest,
  planningItemsJson,
} from "@/features/planning-items/model/planning-items-route";

export async function handleTeamPlanningItemsContext(
  request: NextRequest,
  contract: TeamPlanningItemsApiContract,
) {
  return handlePlanningItemsRequest(
    request,
    "read:planning-context",
    "Planning-Kontext konnte nicht geladen werden.",
    async (permission) => {
      const context = await buildPlanningItemsContext(permission.supabase, permission.profile);
      return planningItemsJson({
        ok: true,
        context: contract.version === "v2" ? planningItemsV2Context(context) : context,
      });
    },
  );
}
