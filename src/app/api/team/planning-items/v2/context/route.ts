import type { NextRequest } from "next/server";
import { handleTeamPlanningItemsContext } from "@/features/planning-items/model/planning-items-team-context-route";
import { teamPlanningItemsV2Contract } from "@/features/planning-items/model/planning-items-team-api-contract";

export async function GET(request: NextRequest) {
  return handleTeamPlanningItemsContext(request, teamPlanningItemsV2Contract);
}
