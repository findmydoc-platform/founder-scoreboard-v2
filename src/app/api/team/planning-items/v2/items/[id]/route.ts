import type { NextRequest } from "next/server";
import {
  handleTeamPlanningItemDelete,
  handleTeamPlanningItemUpdate,
} from "@/features/planning-items/model/planning-items-team-update-route";
import { teamPlanningItemsV2Contract } from "@/features/planning-items/model/planning-items-team-api-contract";

type ItemRouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: ItemRouteContext) {
  return handleTeamPlanningItemUpdate(request, context, teamPlanningItemsV2Contract);
}

export async function DELETE(request: NextRequest, context: ItemRouteContext) {
  return handleTeamPlanningItemDelete(request, context, teamPlanningItemsV2Contract);
}
