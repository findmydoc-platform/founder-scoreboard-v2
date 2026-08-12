import type { NextRequest } from "next/server";
import {
  handleTeamPlanningItemDelete,
  handleTeamPlanningItemUpdate,
} from "@/features/planning-items/model/planning-items-team-update-route";

type ItemRouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: ItemRouteContext) {
  return handleTeamPlanningItemUpdate(request, context);
}

export async function DELETE(request: NextRequest, context: ItemRouteContext) {
  return handleTeamPlanningItemDelete(request, context);
}
