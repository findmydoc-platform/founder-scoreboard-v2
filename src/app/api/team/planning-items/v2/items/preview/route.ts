import type { NextRequest } from "next/server";
import { handleTeamPlanningItemsCreatePreview } from "@/features/planning-items/model/planning-items-team-create-route";
import { teamPlanningItemsV2Contract } from "@/features/planning-items/model/planning-items-team-api-contract";

export async function POST(request: NextRequest) {
  return handleTeamPlanningItemsCreatePreview(request, teamPlanningItemsV2Contract);
}
