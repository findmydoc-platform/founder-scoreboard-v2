import { NextResponse, type NextRequest } from "next/server";
import { requireCEO } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";
import { buildTaskIntakePreview, parseTaskIntakePayload } from "@/lib/task-intake";
import { loadTaskIntakeContext } from "../context";

export async function POST(request: NextRequest) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireCEO(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  const payload = await request.json().catch(() => null);
  const rawTasks = parseTaskIntakePayload(payload);
  if (!rawTasks.length) return NextResponse.json({ error: "Mindestens eine Aufgabe ist erforderlich." }, { status: 400 });
  if (rawTasks.length > 30) return NextResponse.json({ error: "Maximal 30 Aufgaben pro Intake." }, { status: 400 });

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
    return NextResponse.json({ error: error instanceof Error ? error.message : "Task Intake konnte nicht geprüft werden." }, { status: 500 });
  }
}
