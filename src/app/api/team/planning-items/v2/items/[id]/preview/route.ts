import type { NextRequest } from "next/server";
import { handleTeamPlanningItemUpdatePreview } from "@/features/planning-items/model/planning-items-team-update-preview";
import { teamPlanningItemsV2Contract } from "@/features/planning-items/model/planning-items-team-api-contract";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleTeamPlanningItemUpdatePreview(request, context, teamPlanningItemsV2Contract);
}
