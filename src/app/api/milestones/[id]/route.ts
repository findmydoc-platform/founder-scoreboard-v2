import type { NextRequest } from "next/server";
import {
  handleBrowserMilestoneDelete,
  handleBrowserMilestoneUpdate,
} from "@/features/planning-items/model/planning-items-browser-milestone-update";

type MilestoneRouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, context: MilestoneRouteContext) {
  return handleBrowserMilestoneUpdate(request, context);
}

export async function DELETE(request: NextRequest, context: MilestoneRouteContext) {
  return handleBrowserMilestoneDelete(request, context);
}
