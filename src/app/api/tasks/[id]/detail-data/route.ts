import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireApiContext } from "@/lib/api-response";
import { requirePlatformRole } from "@/lib/authz";
import { createSupabaseTaskDetailReadModel } from "@/features/tasks/server/task-detail-read-model-supabase";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireApiContext(
    request,
    (currentRequest) => requirePlatformRole(currentRequest, ["ceo", "founder", "deputy", "viewer"]),
  );
  if (!apiContext.ok) return apiContext.response;

  const { id } = await context.params;
  const result = await createSupabaseTaskDetailReadModel(apiContext.supabase).load(
    { itemId: id },
    { authorized: true, actorProfileId: apiContext.permission.profile?.id || null },
  );
  if (result.status === "forbidden") return apiError("Aufgabe darf nicht geladen werden.", 403);
  if (result.status === "notFound") return apiError("Aufgabe wurde nicht gefunden.", 404);
  if (result.status === "unavailable") return apiError("Task-Details konnten nicht geladen werden.", 503);

  return NextResponse.json({
    taskDetail: result.model,
    unavailable: result.status === "degraded" ? result.unavailable : [],
  });
}
