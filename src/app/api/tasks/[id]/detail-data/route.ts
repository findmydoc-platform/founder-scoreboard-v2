import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-response";
import { requirePlanningContext } from "@/features/planning/server/planning-api-context";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const apiContext = await requirePlanningContext(request, "planning.task.read", id);
  if (!apiContext.ok) return apiContext.response;
  const result = await apiContext.planning.loadDetail();
  if (result.status === "forbidden") return apiError("Aufgabe darf nicht geladen werden.", 403);
  if (result.status === "notFound") return apiError("Aufgabe wurde nicht gefunden.", 404);
  if (result.status === "unavailable") return apiError("Task-Details konnten nicht geladen werden.", 503);

  return NextResponse.json({
    taskDetail: result.model,
    unavailable: result.status === "degraded" ? result.unavailable : [],
  });
}
