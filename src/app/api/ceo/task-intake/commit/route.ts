import { NextResponse, type NextRequest } from "next/server";
import { commitTaskIntake } from "@/features/intake/model/task-intake-commit";
import { buildValidTaskIntakeForRoute, invalidTaskIntakeResponse } from "@/features/intake/model/task-intake-route";
import { requireCEO } from "@/lib/authz";
import { apiError, requireJsonApiContext } from "@/lib/api-response";

export async function POST(request: NextRequest) {
  const context = await requireJsonApiContext(request, requireCEO, null);
  if (!context.ok) return context.response;

  const { payload, permission, supabase } = context;
  try {
    const intake = await buildValidTaskIntakeForRoute({
      supabase,
      payload,
      emptyMessage: "Mindestens eine Aufgabe ist erforderlich.",
      trimParentTaskIds: true,
      invalidMessage: "Task Intake enthält ungültige Aufgaben.",
    });
    if (!intake.ok) {
      return "preview" in intake && intake.preview
        ? invalidTaskIntakeResponse(intake.error, intake.preview, false)
        : apiError(intake.error, intake.status);
    }

    const { context, preview } = intake;

    const tasks = await commitTaskIntake({
      supabase,
      request,
      context,
      preview,
      actorProfileId: permission.profile?.id || null,
      auditAction: "task_intake.create",
      auditSource: "CEO Intake",
    });

    return NextResponse.json({ ok: true, tasks });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Task Intake konnte nicht gespeichert werden.", 500);
  }
}
