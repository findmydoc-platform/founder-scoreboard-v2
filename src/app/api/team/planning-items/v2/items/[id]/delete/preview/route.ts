import type { NextRequest } from "next/server";
import { teamPlanningItemsV2Contract } from "@/features/planning-items/model/planning-items-team-api-contract";
import { handleTeamPlanningItemDeletePreview } from "@/features/planning-items/model/planning-items-team-delete-preview-route";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleTeamPlanningItemDeletePreview(request, context, teamPlanningItemsV2Contract);
}
