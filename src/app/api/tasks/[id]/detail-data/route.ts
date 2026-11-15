import { observeRuntimeHandler, observeRuntimePreparation } from "@/lib/runtime-logging";
import { NextResponse, type NextRequest } from "next/server";
import { apiError } from "@/lib/api-response";
import { requirePlanningContext } from "@/features/planning/server/planning-api-context";

async function handleGET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const apiContext = await requirePlanningContext(request, "planning.task.read", id);
  if (!apiContext.ok) return apiContext.response;
  const area = request.nextUrl.searchParams.get("area");
  if (area !== null && area !== "target" && area !== "complete") return apiError("Ungültiger Detailbereich.", 400);
  const result = await apiContext.planning.loadDetail({ area: area || "complete" });
  if (result.status === "forbidden") return apiError("Aufgabe darf nicht geladen werden.", 403);
  if (result.status === "staleContinuation") return apiError("Die Detailgrundlage hat sich geändert.", 409);
  if (result.status === "notFound") return apiError("Aufgabe wurde nicht gefunden.", 404);
  if (result.status === "unavailable") return apiError("Task-Details konnten nicht geladen werden.", 503);

  const model = result.model;
  return observeRuntimePreparation(() => NextResponse.json({
    taskDetail: model,
    unavailable: result.status === "degraded" ? result.unavailable : [],
  }));
}

export const GET = observeRuntimeHandler("task.detail", handleGET);
