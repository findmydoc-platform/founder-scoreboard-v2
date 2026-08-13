import type { NextRequest } from "next/server";
import { handleTeamPlanningItemsContext } from "@/features/planning-items/model/planning-items-team-context-route";

export async function GET(request: NextRequest) {
  return handleTeamPlanningItemsContext(request);
}
