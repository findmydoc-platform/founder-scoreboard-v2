import type { NextRequest } from "next/server";
import { buildTaskIntakePreviewForRoute, taskIntakePreviewResponse } from "@/features/intake/model/task-intake-route";
import { requireCEO } from "@/lib/authz";
import { apiError, requireJsonApiContext } from "@/lib/api-response";

export async function POST(request: NextRequest) {
  const context = await requireJsonApiContext(request, requireCEO, null);
  if (!context.ok) return context.response;

  const { payload, supabase } = context;
  try {
    const intake = await buildTaskIntakePreviewForRoute({
      supabase,
      payload,
      emptyMessage: "Mindestens eine Aufgabe ist erforderlich.",
      trimParentTaskIds: true,
    });
    if (!intake.ok) return apiError(intake.error, intake.status);
    return taskIntakePreviewResponse(intake.preview);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Task Intake konnte nicht geprüft werden.", 500);
  }
}
