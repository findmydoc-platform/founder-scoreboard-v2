import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireApiContext } from "@/lib/api-response";
import { auditRequestMetadata } from "@/lib/api-input";
import { requirePlanningContributor } from "@/lib/authz";
import { activityMessages, buildTaskUpdateResponsePatch, profileId, type TaskUpdatePayload } from "@/features/tasks/model/task-mutation-contract";
import { linkedIssueNumber } from "@/features/tasks/model/task-route-github";
import {
  applyReviewStatusUpdate,
  applyFinalStatusReopen,
  founderOwnedTaskUpdateFields,
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
import { taskDetailPermissions } from "@/features/tasks/model/task-detail-permissions";
import { archiveGitHubIssue } from "@/lib/github";
import { getGitHubAppInstallationToken } from "@/lib/github-app";
import { isOperationalLeadRole } from "@/lib/platform";
import { createNotificationPayload } from "@/lib/notification-catalog";

type TaskUpdateTransactionResult = {
  task?: { updated_at?: string };
  activities?: Array<{ id: number; task_id: string; message: string; created_at: string }>;
};

type TaskDeletionTransactionResult = {
  operationId?: string;
  status?: "prepared" | "completed";
  task?: TaskDeletionSnapshotRow;
  tasks?: TaskDeletionSnapshotRow[];
  deletedTaskIds?: string[];
  githubClosed?: boolean;
};

type TaskDeletionSnapshotRow = Record<string, unknown> & {
    github_issue_number?: number | null;
    issue_number?: string | null;
    github_issue_url?: string | null;
    issue_url?: string | null;
};

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireApiContext(request, requirePlanningContributor, {
    supabaseUnavailableMessage: "Änderungen konnten nicht dauerhaft gespeichert werden.",
  });
  if (!apiContext.ok) return apiContext.response;

  const { permission, supabase } = apiContext;

  const { id } = await context.params;
  const payload = (await request.json()) as TaskUpdatePayload;
  if (!payload.expectedUpdatedAt || Number.isNaN(Date.parse(payload.expectedUpdatedAt))) {
    return apiError("Aktueller Aufgabenstand ist erforderlich.", 400);
  }
  const update: TaskRouteDbUpdate = {};
  const { data: currentTask } = await supabase
    .from("tasks")
    .select("id,title,task_type,assignee,owner,status,review_status,review_owner_profile_id,review_requested_at,score_final,priority,sprint_id,milestone_id,package_id,start_date,end_date,deadline,evidence_link,updated_at")
    .eq("id", id)
    .single();
  if (!currentTask) {
    return apiError("Aufgabe wurde nicht gefunden.", 404);
  }
  const isOperationalLead = isOperationalLeadRole(permission.profile?.platformRole);
  const isCeo = permission.profile?.platformRole === "ceo";
  const startsReviewRequest = startsTaskReviewRequest(payload);
  const canSetReviewOwner = isCeo;
  const restrictedFields = restrictedTaskUpdateFields(payload);
  const ownerFields = founderOwnedTaskUpdateFields(payload);
  const detailPermissions = taskDetailPermissions({
    task: {
      assignee: currentTask.assignee || "",
      assigneeId: currentTask.assignee || "",
      owner: currentTask.owner || "",
      ownerId: currentTask.owner || "",
      reviewOwnerProfileId: currentTask.review_owner_profile_id || "",
    },
    profile: permission.profile,
    unrestricted: !permission.profile,
  });

  if (!isOperationalLead && restrictedFields.length) {
    return apiError(`Diese Felder sind geschützt: ${restrictedFields.join(", ")}.`, 403);
  }

  if (!isOperationalLead && ownerFields.length && !detailPermissions.canEditBrief) {
    return apiError(`Founder können diese Felder nur bei eigenen Aufgaben ändern: ${ownerFields.join(", ")}.`, 403);
  }

  if (payload.reviewOwnerProfileId !== undefined && !canSetReviewOwner && !startsReviewRequest) {
    return apiError("Nur der CEO kann den Review Owner ändern.", 403);
  }

  const statusGuard = validateTaskStatusUpdate({ currentTask, isOperationalLead, isCeo, payload, profile: permission.profile });
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

  if (payload.assignee !== undefined || payload.owner !== undefined) {
    const nextAssignee = profileId(payload.assignee || payload.owner);
    if (!nextAssignee && currentTask?.task_type !== "proposal") {
      return apiError("Nur Vorschläge können ohne Zuständigkeit bleiben.", 400);
    }
    update.assignee = nextAssignee || null;
    update.owner = nextAssignee || null;
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

  if (payload.reviewOwnerProfileId !== undefined && canSetReviewOwner) {
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

  if (startsReviewRequest) {
    if (currentTask.score_final && !isCeo) {
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
    const requestedReviewOwnerProfileId = canSetReviewOwner && typeof payload.reviewOwnerProfileId === "string" ? profileId(payload.reviewOwnerProfileId) || null : undefined;
    update.review_owner_profile_id = requestedReviewOwnerProfileId !== undefined ? requestedReviewOwnerProfileId : reviewOwnerProfileId || null;
    update.review_requested_at = new Date().toISOString();
  }
  applyFinalStatusReopen(update, currentTask, payload, isCeo);

  const syncStatusGuard = applyTaskSyncStatusUpdate(update, payload);
  if (!syncStatusGuard.ok) return apiError(syncStatusGuard.error, syncStatusGuard.status);
  applyTaskSelfChecklistUpdateFields(update, payload);
  markTaskGitHubSyncDirty(update, payload);

  const messages = activityMessages(payload, currentTask);
  if (update.task_type === "deliverable" && currentTask.task_type === "proposal") {
    messages.push("Aufgabenvorschlag zu Deliverable konvertiert");
  }

  const notifications: Array<Record<string, string | null>> = [];
  if (currentTask && update.review_status === "requested" && currentTask.review_status !== "requested") {
    const reviewOwnerProfileId = typeof update.review_owner_profile_id === "string" ? update.review_owner_profile_id : "";
    let recipients = [{ id: reviewOwnerProfileId }].filter((recipient) => recipient.id);
    if (!recipients.length) {
      const { data: fallbackRecipients, error: recipientError } = await supabase
        .from("profiles")
        .select("id")
        .in("platform_role", ["ceo", "deputy"]);
      if (recipientError) return apiError(recipientError.message, 500);
      recipients = fallbackRecipients || [];
    }
    notifications.push(...recipients.map((recipient) => createNotificationPayload("task.review_requested", {
        actorProfileId: permission.profile?.id,
        recipientProfileId: recipient.id,
        entityType: "task",
        entityId: id,
        title: `Review angefragt: ${currentTask.title}`,
        body: reviewOwnerProfileId
          ? "Diese Aufgabe wartet auf deine Accountable-Review."
          : "Diese Aufgabe wartet auf Review, hat aber keinen Review Owner.",
      })));
  }

  const { data: transactionData, error: transactionError } = await supabase.rpc("update_task_transaction", {
    p_task_id: id,
    p_expected_updated_at: payload.expectedUpdatedAt,
    p_task_patch: update,
    p_note_present: payload.note !== undefined,
    p_note: payload.note ?? null,
    p_dependency_present: payload.dependsOn !== undefined,
    p_dependency_note: payload.dependsOn?.trim().slice(0, 2000) ?? null,
    p_activity_messages: [...new Set(messages)],
    p_notifications: notifications,
  });

  if (transactionError) {
    if (transactionError.code === "P0001") {
      return apiError("Aufgabe wurde zwischenzeitlich geändert. Bitte neu laden.", 409);
    }
    if (transactionError.code === "P0002") return apiError("Aufgabe wurde nicht gefunden.", 404);
    if (transactionError.code === "22023") return apiError("Aufgabenänderung ist ungültig.", 400);
    return apiError(transactionError.message, 500);
  }

  const result = transactionData as TaskUpdateTransactionResult | null;
  if (!result?.task?.updated_at) return apiError("Aufgabe konnte nicht gespeichert werden.", 500);

  const activities = (result.activities || []).map((activity) => ({
    id: activity.id,
    taskId: activity.task_id,
    message: activity.message,
    createdAt: activity.created_at,
  }));
  const taskPatch = {
    ...buildTaskUpdateResponsePatch(id, update, startsReviewRequest),
    id,
    updatedAt: result.task.updated_at,
  };

  return NextResponse.json({
    ok: true,
    activities,
    task: taskPatch,
  });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireApiContext(request, requirePlanningContributor);
  if (!apiContext.ok) return apiContext.response;

  const { permission, supabase } = apiContext;
  const isOperationalLead = isOperationalLeadRole(permission.profile?.platformRole);
  if (!isOperationalLead) return apiError("Nur CEO oder Deputy können Aufgaben löschen.", 403);

  const { id } = await context.params;
  const payload = (await request.json().catch(() => ({}))) as { expectedUpdatedAt?: string };
  if (!payload.expectedUpdatedAt || Number.isNaN(Date.parse(payload.expectedUpdatedAt))) {
    return apiError("Aktueller Aufgabenstand ist erforderlich.", 400);
  }

  const requestMetadata = auditRequestMetadata(request);
  const { data: prepareData, error: prepareError } = await supabase.rpc("prepare_task_deletion_transaction", {
    p_task_id: id,
    p_expected_updated_at: payload.expectedUpdatedAt,
    p_actor_profile_id: permission.profile?.id || null,
    p_request_ip: requestMetadata.request_ip,
    p_user_agent: requestMetadata.user_agent || null,
  });

  if (prepareError) {
    if (prepareError.code === "P0001") {
      return apiError("Aufgabe wurde zwischenzeitlich geändert. Bitte neu laden.", 409);
    }
    if (prepareError.code === "P0002") return apiError("Aufgabe wurde nicht gefunden.", 404);
    if (prepareError.code === "22023") return apiError("Aufgabenlöschung ist ungültig.", 400);
    return apiError(prepareError.message, 500);
  }

  const prepared = prepareData as TaskDeletionTransactionResult | null;
  if (!prepared?.operationId || !prepared.task) {
    return apiError("Aufgabenlöschung konnte nicht vorbereitet werden.", 500);
  }

  if (prepared.status === "completed") {
    return NextResponse.json({
      ok: true,
      deletedTaskId: id,
      deletedTaskIds: prepared.deletedTaskIds || [id],
      githubClosed: prepared.githubClosed || false,
    });
  }

  const issueNumbers = [...new Set((prepared.tasks || [prepared.task])
    .map((task) => linkedIssueNumber(task))
    .filter((issueNumber): issueNumber is number => Boolean(issueNumber)))];
  let githubClosed = false;
  if (issueNumbers.length) {
    try {
      const token = await getGitHubAppInstallationToken();
      for (const issueNumber of issueNumbers) {
        await archiveGitHubIssue(issueNumber, token);
      }
      githubClosed = true;
    } catch (error) {
      const { error: cancelError } = await supabase.rpc("cancel_task_deletion_transaction", {
        p_operation_id: prepared.operationId,
      });
      const message = error instanceof Error ? error.message : "GitHub Issue konnte nicht geschlossen werden.";
      return apiError(
        cancelError
          ? `${message} Der sichere Löschvorgang bleibt für einen erneuten Versuch vorgemerkt.`
          : message,
        502,
      );
    }
  }

  const { data: finalizeData, error: finalizeError } = await supabase.rpc("finalize_task_deletion_transaction", {
    p_operation_id: prepared.operationId,
    p_github_closed: githubClosed,
  });

  if (finalizeError) {
    if (finalizeError.code === "P0001") {
      await supabase.rpc("cancel_task_deletion_transaction", { p_operation_id: prepared.operationId });
      return apiError(
        githubClosed
          ? "Aufgabe wurde parallel geändert. Die externe Ablage ist bereits geschlossen; bitte neu laden und die Löschung erneut bestätigen."
          : "Aufgabe wurde parallel geändert. Bitte neu laden.",
        409,
      );
    }
    if (finalizeError.code === "P0002") return apiError("Aufgabe wurde nicht gefunden.", 404);
    return apiError(`Aufgabenlöschung konnte nicht abgeschlossen werden: ${finalizeError.message}`, 500);
  }

  const finalized = finalizeData as TaskDeletionTransactionResult | null;

  return NextResponse.json({
    ok: true,
    deletedTaskId: id,
    deletedTaskIds: finalized?.deletedTaskIds || prepared.deletedTaskIds || [id],
    githubClosed: finalized?.githubClosed || githubClosed,
  });
}
