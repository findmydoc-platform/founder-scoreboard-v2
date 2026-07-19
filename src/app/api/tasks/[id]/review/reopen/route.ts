import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { requirePlanningContributor, requireTaskReviewer } from "@/lib/authz";
import { apiError, authzError, requireJsonApiContext } from "@/lib/api-response";
import { createNotificationPayload } from "@/lib/notification-catalog";
import { requireActivePlanningItem } from "@/lib/planning-trash-mutation-guard";

type ReopenPayload = {
  expectedUpdatedAt?: string;
};

type ReopenTransactionResult = {
  task?: { updated_at?: string; review_requested_at?: string };
};

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<ReopenPayload>(request, requirePlanningContributor, {});
  if (!apiContext.ok) return apiContext.response;
  const { payload, permission: founderPermission, supabase } = apiContext;
  if (!payload.expectedUpdatedAt || Number.isNaN(Date.parse(payload.expectedUpdatedAt))) {
    return apiError("Aktueller Aufgabenstand ist erforderlich.", 400);
  }

  const { id } = await context.params;
  const activeItem = await requireActivePlanningItem(supabase, "tasks", id);
  if (!activeItem.ok) return apiError(activeItem.error, activeItem.status);
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id,task_type,approval_status,title,assignee,owner,review_status,review_owner_profile_id,sprint_id,score_final,updated_at")
    .eq("id", id)
    .single();

  if (taskError || !task) return apiError("Aufgabe wurde nicht gefunden.", 404);
  if (task.task_type !== "deliverable" || task.approval_status !== "approved") {
    return apiError("Nur freigegebene Deliverables können erneut in Review gegeben werden.", 409);
  }
  if (!task.score_final || task.review_status !== "accepted") {
    return apiError("Nur ein final akzeptiertes Review kann erneut geöffnet werden.", 409);
  }
  if (!task.review_owner_profile_id) {
    return apiError("Lege vor dem erneuten Review eine Review-Verantwortung fest.", 409);
  }
  const { data: reviewOwner, error: reviewOwnerError } = await supabase
    .from("profiles")
    .select("id,platform_role")
    .eq("id", task.review_owner_profile_id)
    .maybeSingle();
  if (reviewOwnerError) return apiError(reviewOwnerError.message, 500);
  if (!reviewOwner || !reviewOwner.platform_role || reviewOwner.platform_role === "viewer") {
    return apiError("Die Review-Verantwortung braucht eine beitragende Rolle.", 409);
  }

  const permission = await requireTaskReviewer(request, task, { ok: true, profile: founderPermission.profile });
  if (!permission.ok) return authzError(permission);

  if (task.sprint_id) {
    const { data: sprint, error: sprintError } = await supabase
      .from("sprints")
      .select("id,score_locked")
      .eq("id", task.sprint_id)
      .single();
    if (sprintError) return apiError(sprintError.message, 500);
    if (sprint?.score_locked) return apiError("Sprint-Score ist bereits gelockt.", 409);
  }

  const notifications: ReturnType<typeof createNotificationPayload>[] = [];
  if (task.review_owner_profile_id) {
    notifications.push(createNotificationPayload("task.review_requested", {
      actorProfileId: permission.profile?.id,
      recipientProfileId: task.review_owner_profile_id,
      entityType: "task",
      entityId: id,
      title: `Review wieder geöffnet: ${task.title}`,
      body: "Diese Aufgabe wartet erneut auf Review.",
    }));
  }
  const assignee = task.assignee || task.owner;
  if (assignee && assignee !== task.review_owner_profile_id) {
    notifications.push(createNotificationPayload("task.review_reopened", {
      actorProfileId: permission.profile?.id,
      recipientProfileId: assignee,
      entityType: "task",
      entityId: id,
      title: `Review wieder geöffnet: ${task.title}`,
      body: "Die Aufgabe wurde zur erneuten Review geöffnet.",
    }));
  }
  const metadata = auditRequestMetadata(request);
  const afterData = { status: "Review", reviewStatus: "requested", scoreFinal: false, reviewOwnerProfileId: task.review_owner_profile_id };
  const { data: transactionData, error: transactionError } = await supabase.rpc("transition_task_review_transaction", {
    p_task_id: id,
    p_expected_updated_at: payload.expectedUpdatedAt,
    p_action: "reopen",
    p_actor_profile_id: permission.profile?.id || null,
    p_reason: null,
    p_activity_message: "Review wieder geöffnet",
    p_notifications: notifications,
    p_audit_after_data: afterData,
    p_request_ip: metadata.request_ip,
    p_user_agent: metadata.user_agent || null,
  });
  if (transactionError) {
    if (transactionError.code === "P0001") return apiError("Aufgabe wurde parallel geändert. Bitte neu laden.", 409);
    if (transactionError.code === "P0002") return apiError("Aufgabe wurde nicht gefunden.", 404);
    if (transactionError.code === "P0004") return apiError("Dieses Review kann nicht erneut geöffnet werden.", 409);
    return apiError(transactionError.message, 500);
  }

  const transition = transactionData as ReopenTransactionResult | null;
  const reviewRequestedAt = transition?.task?.review_requested_at || "";
  const updatedAt = transition?.task?.updated_at || "";
  if (!updatedAt || !reviewRequestedAt) return apiError("Review konnte nicht vollständig wieder geöffnet werden.", 500);

  return NextResponse.json({
    ok: true,
    task: {
      id,
      status: "Review",
      reviewStatus: "requested",
      scoreFinal: false,
      scorePoints: 0,
      reviewOwnerProfileId: task.review_owner_profile_id || "",
      reviewRequestedAt,
      githubIssueSyncStatus: "not_synced",
      updatedAt,
    },
  });
}
