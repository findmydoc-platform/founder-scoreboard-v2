import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireApiContext } from "@/lib/api-response";
import { requireFounder } from "@/lib/authz";
import { activityMessages, buildTaskUpdateResponsePatch, profileId, type TaskUpdatePayload } from "@/features/tasks/model/task-mutation-contract";
import { linkedIssueNumber } from "@/features/tasks/model/task-route-github";
import {
  applyReviewStatusUpdate,
  applyTaskBriefUpdateFields,
  applyTaskPriorityUpdate,
  applyTaskScoreUpdateFields,
  applyTaskSelfChecklistUpdateFields,
  applyTaskStatusUpdate,
  applyTaskSyncStatusUpdate,
  markTaskGitHubSyncDirty,
  proposalPromotionState,
  restrictedTaskUpdateFields,
  startsTaskReviewRequest,
  validateTaskStatusUpdate,
  type TaskRouteDbUpdate,
} from "@/features/tasks/model/task-route-update-helpers";
import { archiveGitHubIssue } from "@/lib/github";
import { optionalMatchingGitHubProviderToken } from "@/lib/github-provider-auth";
import { isOperationalLeadRole } from "@/lib/platform";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireApiContext(request, requireFounder, {
    supabaseUnavailableMessage: "Supabase env is not configured. UI changes remain local only.",
  });
  if (!apiContext.ok) return apiContext.response;

  const { permission, supabase } = apiContext;

  const { id } = await context.params;
  const payload = (await request.json()) as TaskUpdatePayload;
  const update: TaskRouteDbUpdate = {};
  const { data: currentTask } = await supabase
    .from("tasks")
    .select("id,title,task_type,owner,status,review_status,review_owner_profile_id,review_requested_at,score_final,priority,sprint_id,milestone_id,package_id,start_date,end_date,deadline,evidence_link")
    .eq("id", id)
    .single();
  if (!currentTask) {
    return apiError("Aufgabe wurde nicht gefunden.", 404);
  }
  const isOperationalLead = isOperationalLeadRole(permission.profile?.platformRole);
  const restrictedFields = restrictedTaskUpdateFields(payload);

  if (!isOperationalLead && restrictedFields.length) {
    return apiError(`Diese Felder sind geschützt: ${restrictedFields.join(", ")}.`, 403);
  }

  if (payload.reviewOwnerProfileId !== undefined && permission.profile?.platformRole !== "ceo") {
    return apiError("Nur der CEO kann den Review Owner ändern.", 403);
  }

  const statusGuard = validateTaskStatusUpdate({ currentTask, isOperationalLead, payload, profile: permission.profile });
  if (!statusGuard.ok) return apiError(statusGuard.error, statusGuard.status);
  applyTaskStatusUpdate(update, payload);

  const priorityGuard = applyTaskPriorityUpdate(update, payload);
  if (!priorityGuard.ok) return apiError(priorityGuard.error, priorityGuard.status);

  if (payload.milestoneId !== undefined) {
    const nextMilestoneId = payload.milestoneId || null;
    if (nextMilestoneId) {
      const { data: milestone, error: milestoneError } = await supabase
        .from("milestones")
        .select("id")
        .eq("id", nextMilestoneId)
        .single();
      if (milestoneError || !milestone) return apiError("Meilenstein wurde nicht gefunden.", 404);
    }
    update.milestone_id = nextMilestoneId;
  }

  if (payload.packageId !== undefined) {
    const nextPackageId = payload.packageId || null;
    if (nextPackageId) {
      const { data: initiative, error: initiativeError } = await supabase
        .from("packages")
        .select("id,milestone_id,owner_id,accountable_profile_id")
        .eq("id", nextPackageId)
        .single();
      if (initiativeError || !initiative) return apiError("Initiative wurde nicht gefunden.", 404);
      update.package_id = nextPackageId;
      if (payload.milestoneId === undefined) update.milestone_id = initiative.milestone_id || null;
      if (payload.reviewOwnerProfileId === undefined && !currentTask.review_owner_profile_id) {
        update.review_owner_profile_id = initiative.accountable_profile_id || initiative.owner_id || null;
      }
    } else {
      update.package_id = null;
    }
  }

  if (payload.owner !== undefined) {
    const nextOwner = profileId(payload.owner);
    if (!nextOwner && currentTask?.task_type !== "proposal") {
      return apiError("Nur Vorschläge können ohne Assignee bleiben.", 400);
    }
    update.owner = nextOwner || null;
    update.assignee = nextOwner || null;
  }

  applyTaskBriefUpdateFields(update, payload);

  if (payload.sprintId !== undefined) {
    const nextSprintId = payload.sprintId || null;
    if (nextSprintId) {
      const { data: sprint, error: sprintError } = await supabase
        .from("sprints")
        .select("id,score_locked")
        .eq("id", nextSprintId)
        .single();
      if (sprintError || !sprint) return apiError("Sprint wurde nicht gefunden.", 404);
      if (sprint.score_locked) return apiError("Gelockte Sprints können nicht mehr zugewiesen werden.", 409);
    }
    update.sprint_id = nextSprintId;
  }

  const { effectivePackageId, effectiveSprintId, shouldPromoteProposal } = proposalPromotionState(currentTask, update);

  if (shouldPromoteProposal) {
    if (!effectivePackageId || !effectiveSprintId) {
      return apiError("Für ein Deliverable fehlen noch Initiative oder Sprint.", 400);
    }
    update.task_type = "deliverable";
    update.score_relevant = true;
  }

  const reviewStatusGuard = applyReviewStatusUpdate(update, payload, isOperationalLead);
  if (!reviewStatusGuard.ok) return apiError(reviewStatusGuard.error, reviewStatusGuard.status);
  applyTaskScoreUpdateFields(update, payload);

  if (payload.reviewOwnerProfileId !== undefined) {
    const nextReviewOwner = profileId(payload.reviewOwnerProfileId);
    if (nextReviewOwner) {
      const { data: reviewOwner, error: reviewOwnerError } = await supabase
        .from("profiles")
        .select("id")
        .eq("id", nextReviewOwner)
        .single();
      if (reviewOwnerError || !reviewOwner) return apiError("Review Owner wurde nicht gefunden.", 404);
    }
    update.review_owner_profile_id = nextReviewOwner || null;
  }

  const startsReviewRequest = startsTaskReviewRequest(payload);
  if (startsReviewRequest) {
    if (currentTask.score_final) {
      return apiError("Final bewertete Aufgaben können nicht erneut in Review gegeben werden.", 409);
    }

    const reviewPackageId = typeof update.package_id === "string" ? update.package_id : currentTask.package_id || "";
    let reviewOwnerProfileId = "";
    if (reviewPackageId) {
      const { data: initiative, error: initiativeError } = await supabase
        .from("packages")
        .select("owner_id,accountable_profile_id")
        .eq("id", reviewPackageId)
        .maybeSingle();
      if (initiativeError) return apiError(initiativeError.message, 500);
      reviewOwnerProfileId = initiative?.accountable_profile_id || initiative?.owner_id || "";
    }

    update.status = "Review";
    update.review_status = "requested";
    update.score_final = false;
    update.review_owner_profile_id = typeof payload.reviewOwnerProfileId === "string" ? profileId(payload.reviewOwnerProfileId) || null : reviewOwnerProfileId || null;
    update.review_requested_at = new Date().toISOString();
  }

  const syncStatusGuard = applyTaskSyncStatusUpdate(update, payload);
  if (!syncStatusGuard.ok) return apiError(syncStatusGuard.error, syncStatusGuard.status);
  applyTaskSelfChecklistUpdateFields(update, payload);
  markTaskGitHubSyncDirty(update, payload);

  if (Object.keys(update).length) {
    const { error } = await supabase.from("tasks").update(update).eq("id", id);
    if (error) return apiError(error.message, 500);
  }

  if (payload.note !== undefined) {
    const { error } = await supabase
      .from("task_notes")
      .upsert({ task_id: id, note: payload.note, updated_at: new Date().toISOString() });
    if (error) return apiError(error.message, 500);
  }

  if (payload.dependsOn !== undefined) {
    const note = payload.dependsOn.trim().slice(0, 2000);
    const { error: deleteError } = await supabase.from("task_dependencies").delete().eq("task_id", id);
    if (deleteError) return apiError(deleteError.message, 500);
    if (note) {
      const { error: dependencyError } = await supabase.from("task_dependencies").insert({ task_id: id, note });
      if (dependencyError) return apiError(dependencyError.message, 500);
    }
  }

  let activities: Array<{ id: number; taskId: string; message: string; createdAt: string }> = [];
  if (Object.keys(update).length || payload.note !== undefined || payload.dependsOn !== undefined) {
    const messages = activityMessages(payload, currentTask);
    if (update.task_type === "deliverable" && currentTask.task_type === "proposal") {
      messages.push("Aufgabenvorschlag zu Deliverable konvertiert");
    }
    if (messages.length) {
      const { data: activityRows } = await supabase.from("task_activity").insert(
        messages.map((message) => ({
          task_id: id,
          message,
        })),
      ).select("id,task_id,message,created_at");
      activities = (activityRows || []).map((activity) => ({
        id: activity.id,
        taskId: activity.task_id,
        message: activity.message,
        createdAt: activity.created_at,
      }));
    }
  }

  if (currentTask && update.review_status === "requested" && currentTask.review_status !== "requested") {
    const reviewOwnerProfileId = typeof update.review_owner_profile_id === "string" ? update.review_owner_profile_id : "";
    const recipients = reviewOwnerProfileId
      ? [{ id: reviewOwnerProfileId }]
      : (await supabase.from("profiles").select("id").in("platform_role", ["ceo", "deputy"])).data || [];
    const notifications = recipients
      .map((recipient) => ({
        type: "task.review_requested",
        actor_profile_id: permission.profile?.id || null,
        recipient_profile_id: recipient.id,
        entity_type: "task",
        entity_id: id,
        title: `Review angefragt: ${currentTask.title}`,
        body: reviewOwnerProfileId
          ? "Diese Aufgabe wartet auf deine Accountable-Review."
          : "Diese Aufgabe wartet auf Review, hat aber keinen Review Owner.",
      }));
    if (notifications.length) {
      await supabase.from("notification_events").insert(notifications);
    }
  }

  const taskPatch = buildTaskUpdateResponsePatch(id, update, startsReviewRequest);

  return NextResponse.json({
    ok: true,
    activities,
    task: taskPatch,
  });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireApiContext(request, requireFounder);
  if (!apiContext.ok) return apiContext.response;

  const { permission, supabase } = apiContext;
  const isOperationalLead = isOperationalLeadRole(permission.profile?.platformRole);
  if (!isOperationalLead) return apiError("Nur CEO oder Deputy können Aufgaben löschen.", 403);

  const { id } = await context.params;
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id,title,github_issue_number,github_issue_url,issue_number,issue_url")
    .eq("id", id)
    .single();
  if (taskError || !task) return apiError("Aufgabe wurde nicht gefunden.", 404);

  const issueNumber = linkedIssueNumber(task);
  let githubClosed = false;
  if (issueNumber) {
    try {
      const token = await optionalMatchingGitHubProviderToken(request, permission.profile);
      if (!token) {
        return apiError("Für verknüpfte GitHub-Issues bitte die GitHub-Verbindung im Header erneuern und dann erneut löschen.", 409);
      }
      await archiveGitHubIssue(issueNumber, token);
      githubClosed = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "GitHub Issue konnte nicht geschlossen werden.";
      return apiError(message, 502);
    }
  }

  const { error: deleteError } = await supabase.from("tasks").delete().eq("id", id);
  if (deleteError) return apiError(deleteError.message, 500);

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile?.id || null,
    action: "task.delete",
    entity_type: "task",
    entity_id: id,
    before_data: task,
    after_data: { deleted: true, githubClosed },
    request_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: request.headers.get("user-agent"),
  });

  return NextResponse.json({ ok: true, deletedTaskId: id, githubClosed });
}
