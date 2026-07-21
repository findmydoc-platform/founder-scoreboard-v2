import type { SupabaseClient } from "@supabase/supabase-js";
import { mapTaskAuditActivity, mapTaskBlocker, mapTaskComment, mapTaskExternalComment, mapTaskRelation, mapTaskReview } from "@/lib/planning-data-mappers";
import type { DbTaskAuditActivity, DbTaskBlocker, DbTaskComment, DbTaskExternalComment, DbTaskRelation, DbTaskReview } from "@/lib/planning-data-row-types";
import type { PlanningData } from "@/lib/types";
import { ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";

export type TaskDetailData = Pick<
  PlanningData,
  "taskComments" | "taskExternalComments" | "taskBlockers" | "taskRelations" | "taskActivity" | "taskReviews"
>;

export const emptyTaskDetailData: TaskDetailData = {
  taskComments: [],
  taskExternalComments: [],
  taskBlockers: [],
  taskRelations: [],
  taskActivity: [],
  taskReviews: [],
};

type TaskDetailDataResult =
  | { ok: true; data: TaskDetailData }
  | { ok: false; status: number; error: string };

function firstQueryError(results: Array<{ error: { message?: string } | null }>) {
  return results.find((result) => result.error)?.error;
}

function uniqueRelationRows(rows: DbTaskRelation[]) {
  const seen = new Set<number>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

export async function loadTaskDetailData(supabase: SupabaseClient, taskId: string): Promise<TaskDetailDataResult> {
  const taskResult = await supabase.from(ACTIVE_TASKS_TABLE).select("id").eq("id", taskId).maybeSingle();
  if (taskResult.error) return { ok: false, status: 500, error: taskResult.error.message };
  if (!taskResult.data) return { ok: false, status: 404, error: "Aufgabe wurde nicht gefunden." };

  const [
    commentResult,
    externalCommentResult,
    blockerResult,
    auditResult,
    outgoingRelationResult,
    incomingRelationResult,
    reviewResult,
  ] = await Promise.all([
    supabase.from("task_comments").select("id,task_id,profile_id,comment,created_at,task_comment_github_deliveries(status,github_comment_url)").eq("task_id", taskId).order("created_at", { ascending: false }).limit(200),
    supabase.from("task_external_comments").select("id,task_id,source,external_id,author_login,author_avatar_url,body,html_url,created_at,imported_at").eq("task_id", taskId).order("created_at", { ascending: false }).limit(300),
    supabase.from("task_blockers").select("id,task_id,profile_id,reason,impact,needs_help_from,status,created_at,resolved_at").eq("task_id", taskId).order("created_at", { ascending: false }).limit(200),
    supabase.from("task_audit_timeline").select("id,task_id,action,actor_profile_id,message,payload,created_at").eq("task_id", taskId).order("created_at", { ascending: true }).limit(500),
    supabase.from("task_relationship_edges").select("id,task_id,related_task_id,relation_type,note,created_by,created_at").eq("task_id", taskId).order("created_at", { ascending: false }).limit(250),
    supabase.from("task_relationship_edges").select("id,task_id,related_task_id,relation_type,note,created_by,created_at").eq("related_task_id", taskId).order("created_at", { ascending: false }).limit(250),
    supabase.from("task_reviews").select("id,task_id,sprint_id,reviewer_profile_id,decision,points,comment,checklist,created_at").eq("task_id", taskId).order("created_at", { ascending: false }).limit(100),
  ]);

  const queryError = firstQueryError([
    commentResult,
    externalCommentResult,
    blockerResult,
    auditResult,
    outgoingRelationResult,
    incomingRelationResult,
    reviewResult,
  ]);
  if (queryError) return { ok: false, status: 500, error: queryError.message || "Task detail data could not be loaded." };

  const relationRows = uniqueRelationRows([
    ...((outgoingRelationResult.data || []) as DbTaskRelation[]),
    ...((incomingRelationResult.data || []) as DbTaskRelation[]),
  ]);

  return {
    ok: true,
    data: {
      taskComments: ((commentResult.data || []) as DbTaskComment[]).map(mapTaskComment),
      taskExternalComments: ((externalCommentResult.data || []) as DbTaskExternalComment[]).map(mapTaskExternalComment),
      taskBlockers: ((blockerResult.data || []) as DbTaskBlocker[]).map(mapTaskBlocker),
      taskRelations: relationRows.map(mapTaskRelation),
      taskReviews: ((reviewResult.data || []) as DbTaskReview[]).map(mapTaskReview),
      taskActivity: ((auditResult.data || []) as DbTaskAuditActivity[]).map(mapTaskAuditActivity),
    },
  };
}
