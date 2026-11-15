import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { taskDetailReadLimits, type TaskDetailReadArea } from "@/features/tasks/model/task-detail-read-model";

export async function readPlanningDetailSource(supabase: SupabaseClient, itemId: string, area: TaskDetailReadArea) {
  const result = await supabase.rpc("planning_detail_source", { p_item_id: itemId, p_area: area });
  const value = result.data;
  if (result.error || !value || typeof value.source_revision !== "string"
    || typeof value.observed_at !== "string" || !Number.isFinite(Date.parse(value.observed_at))
    || !(value.valid_until === null || typeof value.valid_until === "string" && Number.isFinite(Date.parse(value.valid_until)))) return null;
  const targetId: unknown = value.target_id, ancestorIds: unknown = value.ancestor_ids;
  if (!(targetId === null || targetId === itemId) || !Array.isArray(ancestorIds)
    || ancestorIds.length > taskDetailReadLimits.ancestorDepth
    || ancestorIds.some(id => typeof id !== "string" || !id.length || id.length > 512 || id === targetId)
    || new Set(ancestorIds).size !== ancestorIds.length || targetId === null && ancestorIds.length) return null;
  return { descriptor: { targetId: targetId as string | null, ancestorIds: ancestorIds as string[] }, sourceRevision: value.source_revision as string, observedAt: value.observed_at as string, validUntil: value.valid_until as string | null };
}
