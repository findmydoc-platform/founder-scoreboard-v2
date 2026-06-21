import { NextResponse, type NextRequest } from "next/server";
import { requireCEO } from "@/lib/authz";
import { commitTaskIntake } from "@/lib/task-intake-commit";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { buildTaskIntakePreviewForRoute } from "@/lib/task-intake-route";

export async function POST(request: NextRequest) {
  const context = await requireJsonApiContext(request, requireCEO, null);
  if (!context.ok) return context.response;

  const { payload, permission, supabase } = context;
  try {
    const intake = await buildTaskIntakePreviewForRoute({
      supabase,
      payload,
      emptyMessage: "Mindestens eine Aufgabe ist erforderlich.",
      trimParentTaskIds: true,
    });
    if (!intake.ok) return apiError(intake.error, intake.status);

    const { context, preview } = intake;
    const invalid = preview.filter((task) => task.errors.length > 0);
    if (invalid.length) {
      return NextResponse.json({ error: "Task Intake enthält ungültige Aufgaben.", tasks: preview }, { status: 400 });
    }

    const tasks = await commitTaskIntake({
      supabase,
      request,
      context,
      preview,
      actorProfileId: permission.profile?.id || null,
      auditAction: "task_intake.create",
      activitySource: "CEO Intake",
    });

    return NextResponse.json({ ok: true, tasks });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Task Intake konnte nicht gespeichert werden.", 500);
  }
}
