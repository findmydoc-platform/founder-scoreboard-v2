import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { requirePlanningContributor } from "@/lib/authz";
import { createNotificationPayload } from "@/lib/notification-catalog";
import { isOperationalLeadRole } from "@/lib/platform";
import { requireActivePlanningItem } from "@/lib/planning-trash-mutation-guard";
import { taskOwnedByProfile } from "@/features/tasks/model/task-detail-permissions";

type WithdrawPayload = {
  reason?: string;
  expectedUpdatedAt?: string;
};

type WithdrawTransactionResult = {
  task?: { updated_at?: string };
};

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<WithdrawPayload>(request, requirePlanningContributor, {});
  if (!apiContext.ok) return apiContext.response;

  const { payload, permission, supabase } = apiContext;
  const { id } = await context.params;
  const activeItem = await requireActivePlanningItem(supabase, "tasks", id);
  if (!activeItem.ok) return apiError(activeItem.error, activeItem.status);

  const reason = cleanText(payload.reason, 2000);
  if (reason.length < 2) return apiError("Ein Grund für das Zurückziehen ist erforderlich.", 400);
  if (!payload.expectedUpdatedAt || Number.isNaN(Date.parse(payload.expectedUpdatedAt))) {
    return apiError("Aktueller Aufgabenstand ist erforderlich.", 400);
  }

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id,title,task_type,assignee,owner,review_status,review_owner_profile_id,updated_at")
    .eq("id", id)
    .single();
  if (taskError || !task) return apiError("Aufgabe wurde nicht gefunden.", 404);
  if (task.review_status !== "requested") return apiError("Dieses Review ist nicht mehr aktiv.", 409);

  const profile = permission.profile;
  const canWithdraw = !profile
    || isOperationalLeadRole(profile.platformRole)
    || taskOwnedByProfile({
      assignee: task.assignee || "",
      assigneeId: task.assignee || "",
      owner: task.owner || "",
      ownerId: task.owner || "",
      reviewOwnerProfileId: task.review_owner_profile_id || "",
      reviewStatus: "requested",
      scoreFinal: false,
      taskType: task.task_type === "sub_issue" ? "sub_issue" : "deliverable",
    }, profile);
  if (!canWithdraw) return apiError("Nur die Zuständigkeit, CEO oder Deputy können dieses Review zurückziehen.", 403);

  const reviewerId = task.review_owner_profile_id || "";
  const notifications = reviewerId && reviewerId !== profile?.id
    ? [createNotificationPayload("task.review_withdrawn", {
      actorProfileId: profile?.id,
      recipientProfileId: reviewerId,
      entityType: "task",
      entityId: id,
      title: `Review zurückgezogen: ${task.title}`,
      body: reason,
    })]
    : [];

  const metadata = auditRequestMetadata(request);
  const afterData = { status: "In Arbeit", reviewStatus: "not_requested", scoreFinal: false, reason };
  const { data: transactionData, error: transactionError } = await supabase.rpc("transition_task_review_transaction", {
    p_task_id: id,
    p_expected_updated_at: payload.expectedUpdatedAt,
    p_action: "withdraw",
    p_notifications: notifications,
    p_actor_profile_id: profile?.id || null,
    p_reason: reason,
    p_activity_message: `Review zurückgezogen: ${reason}`,
    p_audit_after_data: afterData,
    p_request_ip: metadata.request_ip,
    p_user_agent: metadata.user_agent || null,
  });

  if (transactionError) {
    if (transactionError.code === "P0001") return apiError("Aufgabe wurde parallel geändert. Bitte neu laden.", 409);
    if (transactionError.code === "P0002") return apiError("Aufgabe wurde nicht gefunden.", 404);
    if (transactionError.code === "P0004") return apiError("Dieses Review ist nicht mehr aktiv.", 409);
    return apiError(transactionError.message, 500);
  }

  const updatedAt = (transactionData as WithdrawTransactionResult | null)?.task?.updated_at;
  if (!updatedAt) return apiError("Review konnte nicht zurückgezogen werden.", 500);

  return NextResponse.json({
    ok: true,
    task: {
      id,
      status: "In Arbeit",
      reviewStatus: "not_requested",
      scoreFinal: false,
      scorePoints: 0,
      reviewRequestedAt: "",
      githubIssueSyncStatus: "not_synced",
      updatedAt,
    },
  });
}
