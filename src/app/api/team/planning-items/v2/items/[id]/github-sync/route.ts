import type { NextRequest } from "next/server";
import { handleTeamPlanningItemGitHubSync } from "@/features/planning-items/model/planning-items-team-github-sync-route";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handleTeamPlanningItemGitHubSync(request, context);
}
