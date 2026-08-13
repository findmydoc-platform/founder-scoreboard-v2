import type { NextRequest } from "next/server";
import { handleTeamPlanningItemsCreate } from "@/features/planning-items/model/planning-items-team-create-route";

export async function POST(request: NextRequest) {
  return handleTeamPlanningItemsCreate(request);
}
