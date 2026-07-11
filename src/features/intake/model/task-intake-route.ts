import { NextResponse } from "next/server";
import { buildTaskIntakePreview, parseTaskIntakePayload, type TaskIntakeInput } from "@/features/intake/model/task-intake";
import { loadTaskIntakeContext } from "@/features/intake/model/task-intake-context";
import { getServerSupabase } from "@/lib/supabase";
import type { TaskIntakePreviewTask } from "@/features/intake/model/task-intake";

type SupabaseClient = NonNullable<ReturnType<typeof getServerSupabase>>;

type TaskIntakePreviewRouteOptions = {
  supabase: SupabaseClient;
  payload: unknown;
  emptyMessage: string;
  trimParentTaskIds: boolean;
};

export function parentTaskIdsFromIntake(rawTasks: TaskIntakeInput[], trimParentTaskIds: boolean) {
  return [...new Set(rawTasks
    .map((task) => {
      if (typeof task.parentTaskId !== "string") return "";
      return trimParentTaskIds ? task.parentTaskId.trim() : task.parentTaskId;
    })
    .filter(Boolean))];
}

export async function buildTaskIntakePreviewForRoute({
  supabase,
  payload,
  emptyMessage,
  trimParentTaskIds,
}: TaskIntakePreviewRouteOptions) {
  const rawTasks = parseTaskIntakePayload(payload);
  if (!rawTasks.length) return { ok: false as const, error: emptyMessage, status: 400 };
  if (rawTasks.length > 30) return { ok: false as const, error: "Maximal 30 Aufgaben pro Intake.", status: 400 };

  const context = await loadTaskIntakeContext(supabase, parentTaskIdsFromIntake(rawTasks, trimParentTaskIds));
  const preview = buildTaskIntakePreview(rawTasks, context);
  return { ok: true as const, context, preview };
}

export function taskIntakePreviewResponse(preview: TaskIntakePreviewTask[]) {
  return NextResponse.json({
    ok: true,
    valid: preview.every((task) => task.errors.length === 0),
    tasks: preview,
  });
}

export function invalidTaskIntakeResponse(error: string, tasks: TaskIntakePreviewTask[], includeOk = true) {
  return NextResponse.json(
    includeOk ? { ok: false, error, tasks } : { error, tasks },
    { status: 400 },
  );
}

export async function buildValidTaskIntakeForRoute(options: TaskIntakePreviewRouteOptions & { invalidMessage: string }) {
  const intake = await buildTaskIntakePreviewForRoute(options);
  if (!intake.ok) return intake;
  const invalid = intake.preview.filter((task) => task.errors.length > 0);
  if (invalid.length) {
    return {
      ok: false as const,
      error: options.invalidMessage,
      status: 400,
      preview: intake.preview,
    };
  }
  return intake;
}
