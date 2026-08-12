import type { NextRequest } from "next/server";
import {
  handleBrowserMilestoneCreate,
  handleBrowserMilestonesRead,
} from "@/features/planning-items/model/planning-items-browser-milestone-route";

export async function GET(request: NextRequest) {
  return handleBrowserMilestonesRead(request);
}

export async function POST(request: NextRequest) {
  return handleBrowserMilestoneCreate(request);
}
