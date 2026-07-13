import type { NextRequest } from "next/server";
import { handlePlanningTrashWithdraw } from "@/lib/planning-trash-api";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handlePlanningTrashWithdraw(request, id, "deliverable");
}
