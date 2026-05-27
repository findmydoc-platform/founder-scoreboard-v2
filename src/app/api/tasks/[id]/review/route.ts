import { NextResponse, type NextRequest } from "next/server";
import { requireOperationalLead } from "@/lib/authz";
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

function defaultPoints(decision: ReviewPayload["decision"], checklist: ReviewPayload["checklist"]) {
  if (decision === "accepted" || decision === "partial") return checklistPoints(checklist);
  return 0;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireOperationalLead(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  const { id } = await context.params;
  const payload = (await request.json()) as ReviewPayload;
  const decision = payload.decision;

  if (!decision || !decisions.has(decision)) {
    return NextResponse.json({ error: "Ungültige Review-Entscheidung." }, { status: 400 });
  }

  const checklist = payload.checklist || {};
  const points = payload.points === undefined ? defaultPoints(decision, checklist) : Math.max(0, Math.min(10, Math.round(Number(payload.points))));
  const comment = typeof payload.comment === "string" ? payload.comment.trim().slice(0, 2000) : "";

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id,sprint_id,title,status,owner")
    .eq("id", id)
    .single();

  if (taskError || !task) return NextResponse.json({ error: "Aufgabe wurde nicht gefunden." }, { status: 404 });

  if (task.sprint_id) {
    const { data: sprint, error: sprintError } = await supabase
      .from("sprints")
      .select("id,score_locked")
      .eq("id", task.sprint_id)
      .single();

    if (sprintError) return NextResponse.json({ error: sprintError.message }, { status: 500 });
    if (sprint?.score_locked) return NextResponse.json({ error: "Sprint-Score ist bereits gelockt." }, { status: 409 });
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
      github_sync_status: "not_synced",
      github_sync_error: null,
    })
    .eq("id", id);

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

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

  if (task.owner && task.owner !== permission.profile?.id) {
    await supabase.from("notification_events").insert({
      type: decision === "changes_requested" ? "task.review_rework" : "task.review_completed",
      actor_profile_id: permission.profile?.id || null,
      recipient_profile_id: task.owner,
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
    request_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: request.headers.get("user-agent"),
  });

  return NextResponse.json({
    ok: true,
    task: {
      id,
      status: nextStatus,
      reviewStatus: decision,
      scorePoints: points,
      scoreFinal,
      githubSyncStatus: "not_synced",
    },
  });
}

