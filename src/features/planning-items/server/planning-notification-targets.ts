import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";
import { planningProjectId } from "./planning-workspace-read-source";

export async function readPlanningNotificationTargets(supabase: SupabaseClient, ids: string[], signal?: AbortSignal) {
  let query = supabase.from(ACTIVE_TASKS_TABLE).select("id,title,task_type").eq("project_id", planningProjectId).in("id", ids);
  if (signal) query = query.abortSignal(signal);
  const result = await query;
  if (result.error) return { status: result.status === 401 || result.status === 403 ? "forbidden" as const : "unavailable" as const };
  if (!Array.isArray(result.data)) return { status: "unavailable" as const };
  const references = result.data.filter(row => typeof row.id === "string" && typeof row.title === "string" && ["epic", "initiative", "deliverable", "sub_issue"].includes(row.task_type))
    .map(row => ({ itemId: row.id as string, title: row.title as string, taskType: row.task_type as "epic" | "initiative" | "deliverable" | "sub_issue" }));
  return { status: "ready" as const, references };
}
