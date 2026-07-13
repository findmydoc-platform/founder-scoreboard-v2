import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireApiContext } from "@/lib/api-response";
import { requirePlanningContributor } from "@/lib/authz";
import { activityMessages, buildTaskUpdateResponsePatch, profileId, type TaskUpdatePayload } from "@/features/tasks/model/task-mutation-contract";
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
  applyTaskTitleUpdate,
  markTaskGitHubSyncDirty,
  restrictedTaskUpdateFields,
  startsTaskReviewRequest,
  validateTaskStatusUpdate,
  type TaskRouteDbUpdate,
} from "@/features/tasks/model/task-route-update-helpers";
import { taskDetailPermissions } from "@/features/tasks/model/task-detail-permissions";
import { isOperationalLeadRole } from "@/lib/platform";
import { createNotificationPayload } from "@/lib/notification-catalog";
import type { Task } from "@/lib/types";

type TaskUpdateTransactionResult = {
  parentApprovalStatus?: Task["parentApprovalStatus"];
  task?: {
    updated_at?: string;
    approval_status?: "draft" | "proposed" | "approved" | "rejected" | null;
    approval_revision?: number;
    proposed_by?: string | null;
    proposed_at?: string | null;
    decided_by?: string | null;
    decided_at?: string | null;
    decision_note?: string | null;
    sprint_id?: string | null;
    score_relevant?: boolean | null;
    package_id?: string | null;
    milestone_id?: string | null;
    parent_task_id?: string | null;
    github_issue_sync_status?: Task["githubIssueSyncStatus"] | null;
    github_issue_sync_error?: string | null;
  };
  activities?: Array<{ id: number; task_id: string; message: string; created_at: string }>;
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
  let nextParentApprovalStatus: Task["parentApprovalStatus"] | undefined;
  const { data: currentTask } = await supabase
    .from("tasks")
    .select("id,title,task_type,approval_status,approval_revision,assignee,owner,status,review_status,review_owner_profile_id,review_requested_at,score_final,priority,sprint_id,milestone_id,package_id,parent_task_id,start_date,end_date,deadline,evidence_link,updated_at")
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
      taskType: currentTask.task_type === "sub_issue" ? "sub_issue" : "deliverable",
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

  if (payload.parentTaskId !== undefined) {
    if (currentTask.task_type !== "sub_issue") {
      return apiError("Nur Sub-Issues können einem anderen Parent-Deliverable zugeordnet werden.", 400);
    }
    if (!detailPermissions.canReparentSubIssue) {
      return apiError("Nur CEO, Deputy oder die aktuelle Zuständigkeit können dieses Sub-Issue verschieben.", 403);
    }

    const nextParentTaskId = payload.parentTaskId.trim();
    if (!nextParentTaskId) return apiError("Ein Parent-Deliverable ist erforderlich.", 400);
    const { data: nextParent, error: nextParentError } = await supabase
      .from("tasks")
      .select("id,task_type,approval_status")
      .eq("id", nextParentTaskId)
      .maybeSingle();
    if (nextParentError) return apiError(nextParentError.message, 500);
    if (!nextParent) return apiError("Parent-Deliverable wurde nicht gefunden.", 404);
    if (nextParent.task_type !== "deliverable") {
      return apiError("Sub-Issues können nur unter Deliverables verschoben werden.", 400);
    }

    nextParentApprovalStatus = nextParent.approval_status as Task["parentApprovalStatus"];
    if (nextParentTaskId !== currentTask.parent_task_id) update.parent_task_id = nextParentTaskId;
  }

  const statusGuard = validateTaskStatusUpdate({ currentTask, isOperationalLead, isCeo, payload, profile: permission.profile });
  if (!statusGuard.ok) return apiError(statusGuard.error, statusGuard.status);
  applyTaskStatusUpdate(update, payload);

  const priorityGuard = applyTaskPriorityUpdate(update, payload);
  if (!priorityGuard.ok) return apiError(priorityGuard.error, priorityGuard.status);

  const titleGuard = applyTaskTitleUpdate(update, payload);
  if (!titleGuard.ok) return apiError(titleGuard.error, titleGuard.status);

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
    if (!nextAssignee) return apiError("Aufgaben brauchen eine Zuständigkeit.", 400);
    update.assignee = nextAssignee || null;
    update.owner = nextAssignee || null;
  }

  applyTaskBriefUpdateFields(update, payload);

  if (payload.sprintId !== undefined) {
    if (currentTask.task_type !== "deliverable" || currentTask.approval_status !== "approved") {
      return apiError("Nur freigegebene Deliverables können einem Sprint zugewiesen werden.", 409);
    }
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
    update.score_relevant = Boolean(nextSprintId);
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
    if (currentTask.task_type !== "deliverable" || currentTask.approval_status !== "approved") {
      return apiError("Nur freigegebene Deliverables können in Review gegeben werden.", 409);
    }
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

  const { data: transactionData, error: transactionError } = await supabase.rpc("update_planning_task_transaction", {
    p_task_id: id,
    p_expected_updated_at: payload.expectedUpdatedAt,
    p_task_patch: update,
    p_note_present: payload.note !== undefined,
    p_note: payload.note ?? null,
    p_dependency_present: payload.dependsOn !== undefined,
    p_dependency_note: payload.dependsOn?.trim().slice(0, 2000) ?? null,
    p_activity_messages: [...new Set(messages)],
    p_notifications: notifications,
    p_actor_profile_id: permission.profile?.id || null,
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
    approvalStatus: result.task.approval_status ?? null,
    approvalRevision: Number(result.task.approval_revision || 1),
    proposedById: result.task.proposed_by || "",
    proposedAt: result.task.proposed_at || "",
    decidedById: result.task.decided_by || "",
    decidedAt: result.task.decided_at || "",
    decisionNote: result.task.decision_note || "",
    sprintId: result.task.sprint_id || "",
    scoreRelevant: Boolean(result.task.score_relevant),
    ...(payload.parentTaskId !== undefined ? {
      parentTaskId: result.task.parent_task_id || "",
      packageId: result.task.package_id || "",
      milestoneId: result.task.milestone_id || "",
      parentApprovalStatus: result.parentApprovalStatus ?? nextParentApprovalStatus ?? null,
      githubIssueSyncStatus: result.task.github_issue_sync_status || "not_synced",
      githubIssueSyncError: result.task.github_issue_sync_error || "",
    } : {}),
  };

  return NextResponse.json({
    ok: true,
    activities,
    task: taskPatch,
  });
}

export async function DELETE() {
  return apiError("Direktes Löschen ist nicht mehr verfügbar. Nutze den Papierkorb-Workflow.", 410);
}
