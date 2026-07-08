import { apiError, authzError, supabaseUnavailable } from "@/lib/api-response";
﻿import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { requireFounder, requireTaskReviewer } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";

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

  const founderPermission = await requireFounder(request);
  if (!founderPermission.ok) return authzError(founderPermission);

  const { id } = await context.params;
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
    .select("id,sprint_id,title,status,assignee,owner,review_owner_profile_id")
    .eq("id", id)
    .single();

  if (taskError || !task) return apiError("Aufgabe wurde nicht gefunden.", 404);
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

  const { error: updateError } = await supabase
    .from("tasks")
    .update({
      review_status: decision,
      score_points: points,
      score_final: scoreFinal,
      status: nextStatus,
      review_requested_at: null,
      github_sync_status: "not_synced",
      github_sync_error: null,
    })
    .eq("id", id);

  if (updateError) return apiError(updateError.message, 500);

  const reviewInsert = {
    task_id: id,
    sprint_id: task.sprint_id || null,
    reviewer_profile_id: permission.profile?.id || null,
    decision,
    points,
    comment,
    checklist,
  };
  const { error: reviewInsertError } = await supabase.from("task_reviews").insert(reviewInsert);
  if (reviewInsertError) {
    await supabase.from("task_reviews").insert({
      task_id: reviewInsert.task_id,
      sprint_id: reviewInsert.sprint_id,
      reviewer_profile_id: reviewInsert.reviewer_profile_id,
      decision,
      points,
      comment,
    });
  }

  await supabase.from("task_activity").insert({
    task_id: id,
    message: decision === "changes_requested" ? `Nacharbeit angefordert: ${comment || "ohne Kommentar"}` : `Review finalisiert: ${decision}, ${points} Punkte`,
  });

  const assignee = task.assignee || task.owner;
  if (assignee && assignee !== permission.profile?.id) {
    await supabase.from("notification_events").insert({
      type: decision === "changes_requested" ? "task.review_rework" : "task.review_completed",
      actor_profile_id: permission.profile?.id || null,
      recipient_profile_id: assignee,
      entity_type: "task",
      entity_id: id,
      title: decision === "changes_requested" ? `Nacharbeit: ${task.title}` : `Review abgeschlossen: ${task.title}`,
      body: comment || `${points} Punkte · ${decision}`,
    });
  }

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile?.id || null,
    action: "task.review",
    entity_type: "task",
    entity_id: id,
    after_data: { decision, points, status: nextStatus, scoreFinal, checklist },
    ...auditRequestMetadata(request),
  });

  return NextResponse.json({
    ok: true,
    task: {
      id,
      status: nextStatus,
      reviewStatus: decision,
      scorePoints: points,
      scoreFinal,
      reviewRequestedAt: "",
      githubSyncStatus: "not_synced",
    },
  });
}
