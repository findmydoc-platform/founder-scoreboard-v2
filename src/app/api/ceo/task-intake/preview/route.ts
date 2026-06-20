import { NextResponse, type NextRequest } from "next/server";
import { requireCEO } from "@/lib/authz";
import { buildTaskIntakePreview, parseTaskIntakePayload } from "@/lib/task-intake";
import { loadTaskIntakeContext } from "@/lib/task-intake-context";
import { apiError, requireJsonApiContext } from "@/lib/api-response";

export async function POST(request: NextRequest) {
  const context = await requireJsonApiContext(request, requireCEO, null);
  if (!context.ok) return context.response;

  const { payload, supabase } = context;
  const rawTasks = parseTaskIntakePayload(payload);
  if (!rawTasks.length) return apiError("Mindestens eine Aufgabe ist erforderlich.", 400);
  if (rawTasks.length > 30) return apiError("Maximal 30 Aufgaben pro Intake.", 400);

  const parentTaskIds = [...new Set(rawTasks.map((task) => typeof task.parentTaskId === "string" ? task.parentTaskId.trim() : "").filter(Boolean))];
  try {
    const context = await loadTaskIntakeContext(supabase, parentTaskIds);
    const preview = buildTaskIntakePreview(rawTasks, context);
    return NextResponse.json({
      ok: true,
      tasks: preview,
      valid: preview.every((task) => task.errors.length === 0),
    });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Task Intake konnte nicht geprüft werden.", 500);
  }
}
