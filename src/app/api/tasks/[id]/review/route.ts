import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { apiError, authzError, supabaseUnavailable } from "@/lib/api-response";
import { requirePlanningContributor, requireTaskReviewer } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";
import { createNotificationPayload } from "@/lib/notification-catalog";
import { requireActivePlanningItem } from "@/lib/planning-trash-mutation-guard";

type ReviewPayload = {
  decision?: "accepted" | "partial" | "changes_requested";
  points?: number;
  comment?: string;
  checklist?: {
    acceptanceCriteriaMet?: boolean;
    dodMet?: boolean;
    evidenceProvided?: boolean;
    communicationClear?: boolean;
    blockerHandled?: boolean;
  };
};

const decisions = new Set(["accepted", "partial", "changes_requested"]);

function checklistPoints(checklist: ReviewPayload["checklist"]) {
  const checked = [
    checklist?.acceptanceCriteriaMet ?? checklist?.dodMet,
    checklist?.evidenceProvided,
    checklist?.communicationClear,
    checklist?.blockerHandled,
  ].filter(Boolean).length;
  return Math.round((checked / 4) * 10);
}

function reviewDecisionPoints(decision: ReviewPayload["decision"], checklist: ReviewPayload["checklist"]) {
  if (decision === "accepted" || decision === "partial") return checklistPoints(checklist);
  return 0;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getServerSupabase();
  if (!supabase) return supabaseUnavailable();

  const founderPermission = await requirePlanningContributor(request);
  if (!founderPermission.ok) return authzError(founderPermission);

  const { id } = await context.params;
  const activeItem = await requireActivePlanningItem(supabase, "tasks", id);
  if (!activeItem.ok) return apiError(activeItem.error, activeItem.status);
  const payload = (await request.json()) as ReviewPayload;
  const decision = payload.decision;

  if (!decision || !decisions.has(decision)) {
    return apiError("Ungültige Review-Entscheidung.", 400);
  }

  const checklist = payload.checklist || {};
  const points = reviewDecisionPoints(decision, checklist);
  const comment = cleanText(payload.comment, 2000);

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id,task_type,approval_status,sprint_id,title,status,assignee,owner,review_owner_profile_id,updated_at")
    .eq("id", id)
    .single();

  if (taskError || !task) return apiError("Aufgabe wurde nicht gefunden.", 404);
  if (task.task_type !== "deliverable" || task.approval_status !== "approved") {
    return apiError("Nur freigegebene Deliverables können reviewed werden.", 409);
  }
  const permission = await requireTaskReviewer(request, task, founderPermission);
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

  const nextStatus = decision === "accepted" ? "Erledigt" : decision === "changes_requested" ? "Nacharbeit" : "Review";
  const scoreFinal = decision !== "changes_requested";

  const reviewerProfileId = permission.profile?.id || null;
  const taskPatch = {
    review_status: decision,
    score_points: points,
    score_final: scoreFinal,
    status: nextStatus,
    review_requested_at: null,
    github_issue_sync_status: "not_synced",
    github_issue_sync_error: null,
  };
  const assignee = task.assignee || task.owner;
  const notifications = assignee && assignee !== reviewerProfileId
    ? [createNotificationPayload(decision === "changes_requested" ? "task.review_rework" : "task.review_completed", {
      actorProfileId: reviewerProfileId,
      recipientProfileId: assignee,
      entityType: "task",
      entityId: id,
      title: decision === "changes_requested" ? `Nacharbeit: ${task.title}` : `Review abgeschlossen: ${task.title}`,
      body: comment || `${points} Punkte · ${decision}`,
    })]
    : [];
  const activityMessage = decision === "changes_requested"
    ? `Nacharbeit angefordert: ${comment || "ohne Kommentar"}`
    : `Review finalisiert: ${decision}, ${points} Punkte`;
  const auditAfterData = { decision, points, status: nextStatus, scoreFinal, checklist };
  const metadata = auditRequestMetadata(request);

  const { error: transactionError } = await supabase.rpc("review_task_transaction", {
    p_task_id: id,
    p_sprint_id: task.sprint_id || null,
    p_expected_updated_at: task.updated_at,
    p_task_patch: taskPatch,
    p_reviewer_profile_id: reviewerProfileId,
    p_decision: decision,
    p_points: points,
    p_comment: comment,
    p_checklist: checklist,
    p_activity_message: activityMessage,
    p_notifications: notifications,
    p_audit_after_data: auditAfterData,
    p_request_ip: metadata.request_ip,
    p_user_agent: metadata.user_agent || null,
  });

  if (transactionError) {
    if (transactionError.code === "P0001") return apiError("Aufgabe wurde parallel geändert. Bitte neu laden.", 409);
    if (transactionError.code === "P0002") return apiError("Aufgabe oder Sprint wurde nicht gefunden.", 404);
    if (transactionError.code === "P0003") return apiError("Sprint-Score ist bereits gelockt.", 409);
    if (transactionError.code === "22023") return apiError("Review-Daten sind ungültig.", 400);
    return apiError(transactionError.message, 500);
  }

  return NextResponse.json({
    ok: true,
    task: {
      id,
      status: nextStatus,
      reviewStatus: decision,
      scorePoints: points,
      scoreFinal,
      reviewRequestedAt: "",
      githubIssueSyncStatus: "not_synced",
    },
  });
}
