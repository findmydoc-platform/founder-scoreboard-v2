import { buildTaskIntakePreview, parseTaskIntakePayload, type TaskIntakeInput } from "@/lib/task-intake";
import { loadTaskIntakeContext } from "@/lib/task-intake-context";
import { getServerSupabase } from "@/lib/supabase";

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
