import { NextResponse, type NextRequest } from "next/server";
import { approvalTransactionError, validateApprovalDecision, type ApprovalDecisionPayload } from "@/lib/approval-api";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { requirePlanningContributor } from "@/lib/authz";
import { mapTaskRow } from "@/lib/planning-task-mappers";
import { attemptPlanningGitHubLifecycleDrain, loadOutstandingPlanningGitHubLifecycleTaskIds } from "@/lib/planning-github-lifecycle-trigger";
import { requireActivePlanningItem } from "@/lib/planning-trash-mutation-guard";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";
import { isReviewStateLocked, reviewStateLockMessage } from "@/features/reviews/model/task-review-state";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<ApprovalDecisionPayload>(request, requirePlanningContributor, {});
  if (!apiContext.ok) return apiContext.response;
  const decision = validateApprovalDecision(apiContext.payload);
  if (!decision.ok) return decision.response;

  const { id } = await context.params;
  const serviceSupabase = getServerServiceRoleSupabase();
  if (!serviceSupabase) return apiError("Server-Service für Freigaben ist nicht konfiguriert.", 503);
  const activeItem = await requireActivePlanningItem(serviceSupabase, "tasks", id);
  if (!activeItem.ok) return apiError(activeItem.error, activeItem.status);
  const { data: taskState, error: taskStateError } = await serviceSupabase
    .from("tasks")
    .select("task_type,review_status,score_final")
    .eq("id", id)
    .single();
  if (taskStateError || !taskState) return apiError("Aufgabe wurde nicht gefunden.", 404);
  if (taskState.task_type !== "initiative" && taskState.task_type !== "deliverable") {
    return apiError("Dieses Planungselement hat keinen Freigabeablauf.", 400);
  }
  if (taskState.task_type === "deliverable" && isReviewStateLocked(taskState.review_status, taskState.score_final)) {
    return apiError(reviewStateLockMessage(taskState.review_status, taskState.score_final), 409);
  }
  const { data, error } = await serviceSupabase.rpc("decide_planning_item_approval_transaction", {
    p_task_id: id,
    p_expected_revision: decision.expectedRevision,
    p_action: decision.action,
    p_actor_profile_id: apiContext.permission.profile?.id || "",
    p_note: decision.note,
  });
  if (error) return approvalTransactionError(error, taskState.task_type === "initiative" ? "Initiative" : "Deliverable");

  const row = (data as { task?: Record<string, unknown> } | null)?.task;
  if (!row) return apiError("Freigabe konnte nicht gespeichert werden.", 500);
  const profileIds = [row.assignee, row.owner, row.created_by].filter((value): value is string => typeof value === "string" && Boolean(value));
  const { data: profiles } = profileIds.length
    ? await serviceSupabase.from("profiles").select("id,name").in("id", [...new Set(profileIds)])
    : { data: [] };
  const profileNames = new Map((profiles || []).map((profile: { id: string; name: string }) => [profile.id, profile.name]));
  const lifecycle = taskState.task_type === "deliverable"
    ? await (async () => {
      const lifecycleScope = await loadOutstandingPlanningGitHubLifecycleTaskIds(serviceSupabase, "deliverable", id);
      return lifecycleScope.error
        ? { attempted: false, completed: false, error: lifecycleScope.error }
        : attemptPlanningGitHubLifecycleDrain({
            rootType: "deliverable",
            rootId: id,
            taskIds: lifecycleScope.taskIds,
            supabase: serviceSupabase,
          });
    })()
    : null;
  return NextResponse.json({ ok: true, task: mapTaskRow(row, profileNames), lifecycle });
}
