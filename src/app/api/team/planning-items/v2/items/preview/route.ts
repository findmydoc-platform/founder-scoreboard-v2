import type { NextRequest } from "next/server";
import { handleTeamPlanningItemsCreatePreview } from "@/features/planning-items/model/planning-items-team-create-route";

export async function POST(request: NextRequest) {
  return handleTeamPlanningItemsCreatePreview(request);
}
