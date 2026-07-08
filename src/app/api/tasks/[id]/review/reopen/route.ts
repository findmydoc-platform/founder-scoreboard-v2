import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { requireFounder, requireTaskReviewer } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";
import { apiError, authzError, supabaseUnavailable } from "@/lib/api-response";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getServerSupabase();
  if (!supabase) return supabaseUnavailable();

  const founderPermission = await requireFounder(request);
  if (!founderPermission.ok) return authzError(founderPermission);

  const { id } = await context.params;
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id,title,assignee,owner,review_owner_profile_id,sprint_id,score_final")
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

  const reviewRequestedAt = new Date().toISOString();
  const { error: updateError } = await supabase
    .from("tasks")
    .update({
      status: "Review",
      review_status: "requested",
      score_final: false,
      score_points: 0,
      review_requested_at: reviewRequestedAt,
      github_sync_status: "not_synced",
      github_sync_error: null,
    })
    .eq("id", id);

  if (updateError) return apiError(updateError.message, 500);

  await supabase.from("task_activity").insert({
    task_id: id,
    message: "Review wieder geöffnet",
  });

  const notifications: Array<{
    type: string;
    actor_profile_id: string | null;
    recipient_profile_id: string;
    entity_type: string;
    entity_id: string;
    title: string;
    body: string;
  }> = [];
  if (task.review_owner_profile_id) {
    notifications.push({
      type: "task.review_requested",
      actor_profile_id: permission.profile?.id || null,
      recipient_profile_id: task.review_owner_profile_id,
      entity_type: "task",
      entity_id: id,
      title: `Review wieder geöffnet: ${task.title}`,
      body: "Diese Aufgabe wartet erneut auf Review.",
    });
  }
  const assignee = task.assignee || task.owner;
  if (assignee && assignee !== task.review_owner_profile_id) {
    notifications.push({
      type: "task.review_requested",
      actor_profile_id: permission.profile?.id || null,
      recipient_profile_id: assignee,
      entity_type: "task",
      entity_id: id,
      title: `Review wieder geöffnet: ${task.title}`,
      body: "Die Aufgabe wurde zur erneuten Review geöffnet.",
    });
  }
  if (notifications.length) await supabase.from("notification_events").insert(notifications);

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile?.id || null,
    action: "task.review.reopen",
    entity_type: "task",
    entity_id: id,
    after_data: { status: "Review", reviewStatus: "requested", scoreFinal: false, reviewOwnerProfileId: task.review_owner_profile_id },
    ...auditRequestMetadata(request),
  });

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
      githubSyncStatus: "not_synced",
    },
  });
}
