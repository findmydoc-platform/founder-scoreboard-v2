import { NextResponse, type NextRequest } from "next/server";
import { requireCEO } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";
import { buildTaskIntakePreview, parseTaskIntakePayload } from "@/lib/task-intake";
import { commitTaskIntake } from "@/lib/task-intake-commit";
import { loadTaskIntakeContext } from "@/lib/task-intake-context";
import { apiError, authzError, supabaseUnavailable } from "@/lib/api-response";

export async function POST(request: NextRequest) {
  const supabase = getServerSupabase();
  if (!supabase) return supabaseUnavailable();

  const permission = await requireCEO(request);
  if (!permission.ok) return authzError(permission);

  const payload = await request.json().catch(() => null);
  const rawTasks = parseTaskIntakePayload(payload);
  if (!rawTasks.length) return apiError("Mindestens eine Aufgabe ist erforderlich.", 400);
  if (rawTasks.length > 30) return apiError("Maximal 30 Aufgaben pro Intake.", 400);

  const parentTaskIds = [...new Set(rawTasks.map((task) => typeof task.parentTaskId === "string" ? task.parentTaskId.trim() : "").filter(Boolean))];

  try {
    const context = await loadTaskIntakeContext(supabase, parentTaskIds);
    const preview = buildTaskIntakePreview(rawTasks, context);
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
