import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-response";
import { requirePlanningContext } from "@/features/planning/server/planning-api-context";

export async function GET(request: NextRequest) {
  const apiContext = await requirePlanningContext(request, "planning.backlog.read");
  if (!apiContext.ok) return apiContext.response;
  const result = await apiContext.planning.loadBacklog();
  if (result.status === "forbidden") return apiError("Backlog darf nicht geladen werden.", 403);
  if (result.status === "unavailable") return apiError("Backlog konnte nicht geladen werden.", 503);
  return NextResponse.json({ model: result.model });
}
