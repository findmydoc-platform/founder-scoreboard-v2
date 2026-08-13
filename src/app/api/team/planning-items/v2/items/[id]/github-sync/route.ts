import type { NextRequest } from "next/server";
import { teamPlanningItemsV2Contract } from "@/features/planning-items/model/planning-items-team-api-contract";
import { handleTeamPlanningItemGitHubSync } from "@/features/planning-items/model/planning-items-team-github-sync-route";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleTeamPlanningItemGitHubSync(request, context, teamPlanningItemsV2Contract);
}
