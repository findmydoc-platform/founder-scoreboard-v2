import { NextResponse, type NextRequest } from "next/server";
import { apiError, requireApiContext } from "@/lib/api-response";
import { requirePlanningContributor } from "@/lib/authz";
import { activityMessages, buildTaskUpdateResponsePatch, profileId, type TaskUpdatePayload } from "@/features/tasks/model/task-mutation-contract";
import { taskAuditActionFromMessage } from "@/features/tasks/model/task-comment-timeline-policy";
import {
  applyReviewStatusUpdate,
  applyFinalStatusReopen,
  founderOwnedTaskUpdateFields,
  applyTaskBriefUpdateFields,
  applyTaskPriorityUpdate,
  applyTaskScoreUpdateFields,
  applyTaskSelfChecklistUpdateFields,
  applyTaskStatusUpdate,
  applyTaskTitleUpdate,
  markTaskGitHubSyncDirty,
  rejectClientGitHubSyncStatusUpdate,
  restrictedTaskUpdateFields,
  validateSubIssueStatusParentApproval,
  validateTaskTypeUpdateFields,
  validateTaskStatusUpdate,
  withoutUnchangedTaskStatus,
  type TaskRouteDbUpdate,
} from "@/features/tasks/model/task-route-update-helpers";
import { taskDetailPermissions } from "@/features/tasks/model/task-detail-permissions";
import { actorContextFromSessionAuth } from "@/features/planning-items/model/planning-actor-context-server";
import {
  browserReviseTransactionFromResult,
  createBrowserRevisePlanningItems,
  planningItemReviseCommand,
} from "@/features/planning-items/model/planning-item-update";
import {
  createPlanningReviewPlanningItems,
  isPlanningReviewRequestPayload,
  parsePlanningReviewRequestPayload,
  planningReviewActivitiesFromResult,
  planningReviewError,
  planningReviewTaskFromResult,
  requestPlanningReviewCommand,
} from "@/features/planning-items/model/planning-items-review";
import {
  changePlanningParentCommand,
  createPlanningReparentPlanningItems,
  isPlanningTaskReparentPayload,
  parsePlanningTaskReparentPayload,
  planningReparentError,
  planningReparentTaskFromResult,
} from "@/features/planning-items/model/planning-items-reparent";
import {
  backlogSprintAssignmentMessage,
  getBacklogSprintAssignmentEligibility,
} from "@/features/backlog/model/backlog-planning-state";
import { isOperationalLeadRole } from "@/lib/platform";
import { auditRequestMetadata } from "@/lib/api-input";
import { ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";
import { requireActivePlanningItem } from "@/lib/planning-trash-mutation-guard";
import type { Task } from "@/lib/types";
import { hasReviewLockedTaskChanges, isTaskReviewActive, isTaskReviewLocked, reviewLockMessage } from "@/features/reviews/model/task-review-state";
import { normalizeEvidenceLinkList } from "@/features/tasks/model/task-evidence-links";
import { allowedPlanningItemStatuses } from "@/features/tasks/model/planning-item-capabilities";
import { mapTaskRow, type TaskRowForMapping } from "@/lib/planning-task-mappers";
import { requireJsonApiContext } from "@/lib/api-response";
import { requireOperationalLead } from "@/lib/authz";
import {
  createEmptyEpicDeletePlanningItems,
  emptyEpicDeleteCommand,
  emptyEpicDeleteError,
  parseEmptyEpicDeletePayload,
} from "@/features/planning-items/model/planning-items-empty-epic-delete";

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
    parent_task_id?: string | null;
    github_issue_sync_status?: Task["githubIssueSyncStatus"] | null;
    github_issue_sync_error?: string | null;
  };
  activities?: Array<{ id: number; task_id: string; message: string; created_at: string }>;
};

function strategicText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function strategicDate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) return undefined;
  return value;
}

export async function handleBrowserTaskUpdate(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireApiContext(request, requirePlanningContributor, {
    supabaseUnavailableMessage: "Änderungen konnten nicht dauerhaft gespeichert werden.",
  });
  if (!apiContext.ok) return apiContext.response;

  const { permission, supabase } = apiContext;

  const { id } = await context.params;
  const rawPayload = await request.json() as unknown;
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return apiError("Aufgabenänderung ist ungültig.", 400);
  }
  if (Object.hasOwn(rawPayload, "packageId") || Object.hasOwn(rawPayload, "milestoneId")) {
    return apiError("Verwende parentTaskId für die übergeordnete Planungsebene.", 400);
  }
  const githubSyncStatusGuard = rejectClientGitHubSyncStatusUpdate(rawPayload);
  if (!githubSyncStatusGuard.ok) return apiError(githubSyncStatusGuard.error, githubSyncStatusGuard.status);
  let payload = { ...rawPayload } as TaskUpdatePayload;
  if (isPlanningReviewRequestPayload(rawPayload)) {
    const parsed = parsePlanningReviewRequestPayload(rawPayload);
    if (!parsed.ok) return apiError(parsed.error, parsed.status);
    const actor = actorContextFromSessionAuth({ ok: true, profile: permission.profile });
    if (!actor.ok) return apiError("Founder können nur den Status ihrer eigenen Aufgaben ändern.", 403);
    const metadata = auditRequestMetadata(request);
    const result = await createPlanningReviewPlanningItems(supabase).run({
      actor: actor.actor,
      mode: "commit",
      command: requestPlanningReviewCommand(id, parsed.value),
      requestMetadata: {
        requestIp: metadata.request_ip || undefined,
        userAgent: metadata.user_agent || undefined,
      },
    });
    if (!result.ok) {
      const mapped = planningReviewError(result.error, "request");
      return apiError(mapped.message, mapped.status);
    }
    const task = planningReviewTaskFromResult(result);
    if (result.status !== "committed" || !task) return apiError("Aufgabe konnte nicht gespeichert werden.", 500);
    const activities = planningReviewActivitiesFromResult(result).map((activity) => ({
      id: activity.id,
      taskId: activity.taskId,
      action: taskAuditActionFromMessage(activity.message),
      actorProfileId: permission.profile?.id || "",
      message: activity.message,
      beforeData: null,
      afterData: { message: activity.message },
      createdAt: activity.createdAt,
    })).filter((activity) => activity.action);
    return NextResponse.json({ ok: true, activities, task });
  }
  if (isPlanningTaskReparentPayload(rawPayload)) {
    const parsed = parsePlanningTaskReparentPayload(rawPayload);
    if (!parsed.ok) return apiError(parsed.error, parsed.status);
    const actor = actorContextFromSessionAuth({ ok: true, profile: permission.profile });
    if (!actor.ok) return apiError("Zuordnung konnte nicht gespeichert werden.", 403);
    const result = await createPlanningReparentPlanningItems(supabase, "any").run({
      actor: actor.actor,
      mode: "commit",
      command: changePlanningParentCommand(id, parsed.value.parentId || null, parsed.value.expectedUpdatedAt),
    });
    if (!result.ok) {
      const mapped = planningReparentError(result.error, "task");
      return apiError(mapped.message, mapped.status);
    }
    const task = planningReparentTaskFromResult(result);
    if (result.status !== "committed" || !task) return apiError("Zuordnung konnte nicht gespeichert werden.", 500);
    return NextResponse.json({
      ok: true,
      activities: [],
      task: {
        id,
        parentTaskId: task.parentTaskId || "",
        parentApprovalStatus: task.parentApprovalStatus ?? null,
        approvalStatus: task.approvalStatus ?? null,
        approvalRevision: Number(task.approvalRevision || 1),
        githubIssueSyncStatus: task.githubIssueSyncStatus || "not_synced",
        githubIssueSyncError: task.githubIssueSyncError || "",
        updatedAt: task.updatedAt,
      },
    });
  }
  const activeItem = await requireActivePlanningItem(supabase, id);
  if (!activeItem.ok) return apiError(activeItem.error, activeItem.status);
  if (!payload.expectedUpdatedAt || Number.isNaN(Date.parse(payload.expectedUpdatedAt))) {
    return apiError("Aktueller Aufgabenstand ist erforderlich.", 400);
  }
  const expectedUpdatedAt = payload.expectedUpdatedAt;
  const update: TaskRouteDbUpdate = {};
  let nextParentApprovalStatus: Task["parentApprovalStatus"] | undefined;
  let sprintAssignmentNoop = false;
  const { data: currentTask } = await supabase
    .from("tasks")
    .select("id,title,description,task_type,approval_status,approval_revision,assignee,owner,status,review_status,review_owner_profile_id,review_requested_at,score_final,priority,sprint_id,score_relevant,parent_task_id,start_date,end_date,deadline,evidence_link,target_date,updated_at")
    .eq("id", id)
    .single();
  if (!currentTask) {
    return apiError("Aufgabe wurde nicht gefunden.", 404);
  }
  const reviseActor = actorContextFromSessionAuth({ ok: true, profile: permission.profile });
  if (!reviseActor.ok) return apiError("Aufgabenänderung ist nicht erlaubt.", 403);
  if (currentTask.task_type === "epic" || currentTask.task_type === "initiative") {
    const isOperationalLead = isOperationalLeadRole(permission.profile?.platformRole);
    const ownsInitiative = currentTask.task_type === "initiative"
      && Boolean(permission.profile?.id)
      && (currentTask.assignee === permission.profile?.id || currentTask.owner === permission.profile?.id);
    if (currentTask.task_type === "epic" && !isOperationalLead) {
      return apiError("Epics können nur von CEO oder Deputy geändert werden.", 403);
    }
    if (currentTask.task_type === "initiative" && !isOperationalLead && !ownsInitiative) {
      return apiError("Nur CEO, Deputy oder der Initiative-Owner können diese Initiative ändern.", 403);
    }
    const allowedFields = new Set([
      "expectedUpdatedAt", "title", "description", "status", "assignee", "owner", "priority",
      "targetDate", "strategy", "raciAssignments",
    ]);
    const unsupportedField = Object.keys(rawPayload).find((field) => !allowedFields.has(field));
    if (unsupportedField) return apiError(`Das Feld ${unsupportedField} ist für strategische Planungselemente nicht zulässig.`, 400);
    if (!isOperationalLead && (payload.assignee !== undefined || payload.owner !== undefined || payload.raciAssignments !== undefined)) {
      return apiError("Parent, Owner und RACI können nur von CEO oder Deputy geändert werden.", 403);
    }
    if (payload.status !== undefined && !allowedPlanningItemStatuses(currentTask.task_type).includes(payload.status as never)) {
      return apiError("Ungültiger strategischer Status.", 400);
    }
    if (currentTask.task_type === "epic" && payload.priority !== undefined) {
      return apiError("Epics haben keine Priorität.", 400);
    }
    if (payload.priority !== undefined && !["P0", "P1", "P2", "P3", "P4"].includes(payload.priority)) {
      return apiError("Ungültige Priorität.", 400);
    }
    if (payload.title !== undefined && strategicText(payload.title, 240).length < 3) {
      return apiError("Titel ist erforderlich.", 400);
    }
    const targetDate = strategicDate(payload.targetDate);
    if (targetDate === undefined) return apiError("Zieldatum ist ungültig.", 400);
    if (payload.strategy !== undefined && currentTask.task_type !== "initiative") {
      return apiError("Nur Initiativen haben eine Strategie.", 400);
    }
    if (payload.raciAssignments !== undefined && currentTask.task_type !== "initiative") {
      return apiError("Nur Initiativen haben RACI-Zuordnungen.", 400);
    }
    const patch: Record<string, string | number | null> = {};
    if (payload.title !== undefined) patch.title = strategicText(payload.title, 240);
    if (payload.description !== undefined) patch.description = strategicText(payload.description, 4_000) || null;
    if (payload.status !== undefined) patch.status = payload.status;
    if (payload.priority !== undefined) patch.priority = payload.priority;
    if (payload.assignee !== undefined || payload.owner !== undefined) {
      const assignee = profileId(payload.assignee || payload.owner);
      if (!assignee) return apiError("Planungselemente brauchen eine Zuständigkeit.", 400);
      patch.assignee = assignee;
      patch.owner = assignee;
    }
    if (payload.targetDate !== undefined) patch.target_date = targetDate;
    const strategy = payload.strategy === undefined ? null : {
      goal: strategicText(payload.strategy.goal, 4_000),
      successCriteria: strategicText(payload.strategy.successCriteria, 6_000),
      scopeConstraints: strategicText(payload.strategy.scopeConstraints, 4_000),
    };
    const raciAssignments = payload.raciAssignments === undefined ? null : payload.raciAssignments.map((assignment, index) => ({
      profileId: profileId(assignment.profileId),
      role: assignment.role,
      sortOrder: Number.isInteger(assignment.sortOrder) && (assignment.sortOrder || 0) >= 0 ? assignment.sortOrder : index,
    }));
    const result = await createBrowserRevisePlanningItems({
      supabase,
      actor: reviseActor.actor,
      writer: { kind: "strategic", params: {
        taskId: id,
        expectedUpdatedAt,
        patch,
        strategy,
        raciAssignments,
      } },
    }).run({
      actor: reviseActor.actor,
      mode: "commit",
      command: planningItemReviseCommand(id, currentTask.task_type, expectedUpdatedAt, payload as Record<string, unknown>),
    });
    if (!result.ok) {
      if (result.error.code === "conflict" && result.error.reason === "revision") return apiError("Planungselement wurde zwischenzeitlich geändert. Bitte neu laden.", 409);
      if (result.error.code === "notFound") return apiError("Planungselement wurde nicht gefunden.", 404);
      if (result.error.code === "invalidCommand") return apiError("Planungselement ist ungültig.", 400);
      if (result.error.code === "forbidden") return apiError("Planungselement konnte nicht geändert werden.", 403);
      return apiError("Planungselement konnte nicht gespeichert werden.", 500);
    }
    const transaction = browserReviseTransactionFromResult(result) as { task?: TaskRowForMapping } | null;
    if (!transaction?.task) return apiError("Planungselement konnte nicht gespeichert werden.", 500);
    const updated = transaction.task;
    const [strategyResult, raciResult, profileResult] = await Promise.all([
      currentTask.task_type === "initiative"
        ? supabase.from("planning_item_strategy").select("task_id,goal,success_criteria,scope_constraints").eq("task_id", id).maybeSingle()
        : Promise.resolve({ data: null }),
      currentTask.task_type === "initiative"
        ? supabase.from("planning_item_raci_assignments").select("task_id,profile_id,role,sort_order").eq("task_id", id).order("sort_order")
        : Promise.resolve({ data: [] }),
      supabase.from("profiles").select("id,name"),
    ]);
    const profileNames = new Map((profileResult.data || []).map((profile: { id: string; name: string }) => [profile.id, profile.name]));
    return NextResponse.json({
      ok: true,
      activities: [],
      task: mapTaskRow(updated, profileNames, {
        strategy: strategyResult.data || undefined,
        raciAssignments: raciResult.data || [],
      }),
    });
  }

  const taskTypeFieldGuard = validateTaskTypeUpdateFields(currentTask, payload);
  if (!taskTypeFieldGuard.ok) return apiError(taskTypeFieldGuard.error, taskTypeFieldGuard.status);
  const hasEvidenceLinks = Object.prototype.hasOwnProperty.call(rawPayload, "evidenceLinks");
  const hasLegacyEvidenceLink = Object.prototype.hasOwnProperty.call(rawPayload, "evidenceLink");
  if (hasEvidenceLinks || hasLegacyEvidenceLink) {
    const normalizedEvidence = normalizeEvidenceLinkList(
      hasEvidenceLinks ? payload.evidenceLinks : [payload.evidenceLink ?? ""],
    );
    if (!normalizedEvidence.ok) return apiError(normalizedEvidence.error, 400);
    payload.evidenceLinks = normalizedEvidence.links;
    payload.evidenceLink = normalizedEvidence.links[0] || "";
  }
  const currentReviewState = { reviewStatus: currentTask.review_status, scoreFinal: Boolean(currentTask.score_final) } as Pick<Task, "reviewStatus" | "scoreFinal">;
  if (currentTask.task_type === "deliverable" && isTaskReviewLocked(currentReviewState) && hasReviewLockedTaskChanges(payload, { allowReviewOwnerChange: isTaskReviewActive(currentReviewState) })) {
    return apiError(reviewLockMessage(currentReviewState), 409);
  }
  if (currentTask.parent_task_id) {
    const { data: parentReviewState, error: parentReviewError } = await supabase
      .from(ACTIVE_TASKS_TABLE)
      .select("review_status,score_final")
      .eq("id", currentTask.parent_task_id)
      .maybeSingle();
    if (parentReviewError) return apiError(parentReviewError.message, 500);
    if (parentReviewState) {
      const parentReviewTask = { reviewStatus: parentReviewState.review_status, scoreFinal: Boolean(parentReviewState.score_final) } as Pick<Task, "reviewStatus" | "scoreFinal">;
      if (isTaskReviewLocked(parentReviewTask)) return apiError(reviewLockMessage(parentReviewTask), 409);
    }
  }
  const normalizedStatusUpdate = withoutUnchangedTaskStatus(currentTask, payload);
  payload = normalizedStatusUpdate.payload;
  const statusNoop = normalizedStatusUpdate.statusNoop;
  const isOperationalLead = isOperationalLeadRole(permission.profile?.platformRole);
  const isCeo = permission.profile?.platformRole === "ceo";
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
      reviewStatus: currentTask.review_status || "not_requested",
      scoreFinal: Boolean(currentTask.score_final),
      taskType: currentTask.task_type === "sub_issue" ? "sub_issue" : "deliverable",
    },
    profile: permission.profile,
  });

  if (!isOperationalLead && restrictedFields.length) {
    return apiError(`Diese Felder sind geschützt: ${restrictedFields.join(", ")}.`, 403);
  }

  if (!isOperationalLead && ownerFields.length && !detailPermissions.canEditBrief) {
    return apiError(`Founder können diese Felder nur bei eigenen Aufgaben ändern: ${ownerFields.join(", ")}.`, 403);
  }

  if (payload.reviewOwnerProfileId !== undefined && !canSetReviewOwner) {
    return apiError("Nur der CEO kann den Review Owner ändern.", 403);
  }
  if (currentTask.review_status === "requested" && payload.reviewOwnerProfileId !== undefined && !profileId(payload.reviewOwnerProfileId)) {
    return apiError("Ein aktives Review braucht eine Review-Verantwortung.", 400);
  }

  const statusGuard = validateTaskStatusUpdate({
    canCompleteSubIssue: detailPermissions.canCompleteSubIssue,
    canReopenSubIssue: detailPermissions.canReopenSubIssue,
    currentTask,
    isOperationalLead,
    isCeo,
    payload,
    profile: permission.profile,
  });
  if (!statusGuard.ok) return apiError(statusGuard.error, statusGuard.status);

  if (payload.status && currentTask.task_type === "sub_issue" && nextParentApprovalStatus === undefined) {
    let currentParent: { approval_status?: string | null; task_type?: string | null } | null = null;
    if (currentTask.parent_task_id) {
      const { data, error } = await supabase
        .from(ACTIVE_TASKS_TABLE)
        .select("id,task_type,approval_status")
        .eq("id", currentTask.parent_task_id)
        .maybeSingle();
      if (error) return apiError(error.message, 500);
      currentParent = data;
    }
    nextParentApprovalStatus = currentParent?.task_type === "deliverable"
      ? currentParent.approval_status as Task["parentApprovalStatus"]
      : null;
  }

  const parentStatusGuard = validateSubIssueStatusParentApproval({
    currentTask,
    parentApprovalStatus: nextParentApprovalStatus,
    payload,
  });
  if (!parentStatusGuard.ok) return apiError(parentStatusGuard.error, parentStatusGuard.status);
  applyTaskStatusUpdate(update, payload);

  const priorityGuard = applyTaskPriorityUpdate(update, payload);
  if (!priorityGuard.ok) return apiError(priorityGuard.error, priorityGuard.status);

  const titleGuard = applyTaskTitleUpdate(update, payload);
  if (!titleGuard.ok) return apiError(titleGuard.error, titleGuard.status);

  if (payload.assignee !== undefined || payload.owner !== undefined) {
    const nextAssignee = profileId(payload.assignee || payload.owner);
    if (!nextAssignee) return apiError("Aufgaben brauchen eine Zuständigkeit.", 400);
    update.assignee = nextAssignee || null;
    update.owner = nextAssignee || null;
  }

  applyTaskBriefUpdateFields(update, payload);
  if (payload.evidenceLinks !== undefined) {
    update.evidence_link = payload.evidenceLinks[0] || null;
    update.evidence_links = payload.evidenceLinks;
  }

  if (payload.sprintId !== undefined) {
    const nextSprintId = payload.sprintId || null;
    const nextPackageId = currentTask.parent_task_id || "";
    const nextAssignee = update.assignee === undefined
      ? currentTask.assignee || ""
      : typeof update.assignee === "string"
        ? update.assignee
        : "";
    const nextOwner = update.owner === undefined
      ? currentTask.owner || ""
      : typeof update.owner === "string"
        ? update.owner
        : "";
    const nextStatus = update.status === undefined
      ? currentTask.status || ""
      : typeof update.status === "string"
        ? update.status
        : "";
    let hasInitiative = false;
    if (nextPackageId) {
      const { data: initiative, error: initiativeError } = await supabase
        .from(ACTIVE_TASKS_TABLE)
        .select("id,task_type")
        .eq("id", nextPackageId)
        .maybeSingle();
      if (initiativeError) return apiError(initiativeError.message, 500);
      hasInitiative = initiative?.task_type === "initiative";
    }

    let targetSprint: { id: string; scoreLocked: boolean } | null = null;
    if (nextSprintId) {
      const { data: sprint, error: sprintError } = await supabase
        .from("sprints")
        .select("id,score_locked")
        .eq("id", nextSprintId)
        .single();
      if (sprintError || !sprint) return apiError("Sprint wurde nicht gefunden.", 404);
      targetSprint = { id: sprint.id, scoreLocked: Boolean(sprint.score_locked) };
    }

    let sourceSprintLocked = false;
    if (currentTask.sprint_id && currentTask.sprint_id !== nextSprintId) {
      const { data: sourceSprint, error: sourceSprintError } = await supabase
        .from("sprints")
        .select("id,score_locked")
        .eq("id", currentTask.sprint_id)
        .maybeSingle();
      if (sourceSprintError) return apiError(sourceSprintError.message, 500);
      if (!sourceSprint) return apiError("Aktueller Sprint wurde nicht gefunden.", 409);
      sourceSprintLocked = Boolean(sourceSprint.score_locked);
    }

    const sprintEligibility = getBacklogSprintAssignmentEligibility({
      taskType: currentTask.task_type,
      approvalStatus: currentTask.approval_status,
      status: nextStatus,
      assignee: nextAssignee,
      owner: nextOwner,
      parentTaskId: nextPackageId,
      hasInitiative,
      sprintId: currentTask.sprint_id,
    }, targetSprint, { sourceSprintLocked });
    if (!sprintEligibility.ok) {
      return apiError(backlogSprintAssignmentMessage(sprintEligibility.reason), 409);
    }
    if (sprintEligibility.action === "noop") {
      sprintAssignmentNoop = true;
    } else {
      update.sprint_id = nextSprintId;
      update.score_relevant = Boolean(nextSprintId);
    }
  }

  const reviewStatusGuard = applyReviewStatusUpdate(update, payload);
  if (!reviewStatusGuard.ok) return apiError(reviewStatusGuard.error, reviewStatusGuard.status);
  applyTaskScoreUpdateFields(update, payload);

  if (payload.reviewOwnerProfileId !== undefined && canSetReviewOwner) {
    const nextReviewOwner = profileId(payload.reviewOwnerProfileId);
    if (nextReviewOwner) {
      const { data: reviewOwner, error: reviewOwnerError } = await supabase
        .from("profiles")
        .select("id,platform_role")
        .eq("id", nextReviewOwner)
        .single();
      if (reviewOwnerError || !reviewOwner) return apiError("Review Owner wurde nicht gefunden.", 404);
      if (!reviewOwner.platform_role || reviewOwner.platform_role === "viewer") {
        return apiError("Die Review-Verantwortung braucht eine beitragende Rolle.", 400);
      }
    }
    update.review_owner_profile_id = nextReviewOwner || null;
  }

  applyFinalStatusReopen(update, currentTask, payload, isCeo, detailPermissions.canReopenSubIssue);

  applyTaskSelfChecklistUpdateFields(update, payload);
  markTaskGitHubSyncDirty(update);

  const messages = activityMessages(payload, currentTask);

  if ((statusNoop || sprintAssignmentNoop) && Object.keys(update).length === 0 && payload.note === undefined && payload.dependsOn === undefined) {
    return NextResponse.json({
      ok: true,
      activities: [],
      task: {
        id,
        updatedAt: currentTask.updated_at,
        approvalStatus: currentTask.approval_status ?? null,
        approvalRevision: Number(currentTask.approval_revision || 1),
        sprintId: currentTask.sprint_id || "",
        scoreRelevant: Boolean(currentTask.score_relevant),
      },
    });
  }

  const reviseResult = await createBrowserRevisePlanningItems({
    supabase,
    actor: reviseActor.actor,
    writer: { kind: "delivery", params: {
      taskId: id,
      expectedUpdatedAt,
      taskPatch: update,
      notePresent: payload.note !== undefined,
      note: payload.note ?? null,
      dependencyPresent: payload.dependsOn !== undefined,
      dependencyNote: payload.dependsOn?.trim().slice(0, 2000) ?? null,
      activityMessages: [...new Set(messages)],
      notifications: [],
    } },
  }).run({
    actor: reviseActor.actor,
    mode: "commit",
    command: planningItemReviseCommand(id, currentTask.task_type, expectedUpdatedAt, payload as Record<string, unknown>),
  });
  if (!reviseResult.ok) {
    if (reviseResult.error.code === "conflict" && reviseResult.error.reason === "revision") {
      return apiError("Aufgabe wurde zwischenzeitlich geändert. Bitte neu laden.", 409);
    }
    if (reviseResult.error.code === "conflict" && reviseResult.error.reason === "state") {
      if (reviseResult.error.details?.reviseState === "reviewLocked") {
        return apiError(reviewLockMessage({ reviewStatus: currentTask.review_status, scoreFinal: Boolean(currentTask.score_final) } as Pick<Task, "reviewStatus" | "scoreFinal">), 409);
      }
      if (reviseResult.error.details?.reviseState === "sprintLocked") {
        return apiError("Sprint-Zuordnung konnte nicht gespeichert werden. Bitte neu laden.", 409);
      }
      return apiError("Unter einem nicht freigegebenen Deliverable bleibt dieses Sub-Issue inaktiv.", 409);
    }
    if (reviseResult.error.code === "notFound") return apiError("Aufgabe wurde nicht gefunden.", 404);
    if (reviseResult.error.code === "invalidCommand") return apiError("Aufgabenänderung ist ungültig.", 400);
    if (reviseResult.error.code === "forbidden") return apiError("Aufgabenänderung ist nicht erlaubt.", 403);
    return apiError("Aufgabe konnte nicht gespeichert werden.", 500);
  }
  const result = browserReviseTransactionFromResult(reviseResult) as TaskUpdateTransactionResult | null;
  if (!result?.task?.updated_at) return apiError("Aufgabe konnte nicht gespeichert werden.", 500);

  const activities = (result.activities || []).map((activity) => ({
    id: activity.id,
    taskId: activity.task_id,
    action: taskAuditActionFromMessage(activity.message),
    actorProfileId: permission.profile?.id || "",
    message: activity.message,
    beforeData: null,
    afterData: { message: activity.message },
    createdAt: activity.created_at,
  })).filter((activity) => activity.action);
  const taskPatch = {
    ...buildTaskUpdateResponsePatch(id, update, false, currentTask.task_type as Task["taskType"]),
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
  };

  return NextResponse.json({
    ok: true,
    activities,
    task: taskPatch,
  });
}

export async function handleBrowserTaskDelete(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const apiContext = await requireJsonApiContext<unknown>(request, requireOperationalLead, null);
  if (!apiContext.ok) return apiContext.response;
  const parsed = parseEmptyEpicDeletePayload(apiContext.payload);
  if (!parsed.ok) return apiError(parsed.error, 400);
  const actor = actorContextFromSessionAuth({ ok: true, profile: apiContext.permission.profile });
  if (!actor.ok) return apiError("Nur CEO oder Deputy können Epics löschen.", 403);
  const { id } = await context.params;
  const metadata = auditRequestMetadata(request);
  const result = await createEmptyEpicDeletePlanningItems(apiContext.supabase).run({
    actor: actor.actor,
    mode: "commit",
    command: emptyEpicDeleteCommand(id.trim(), parsed.expectedUpdatedAt),
    requestMetadata: {
      requestIp: metadata.request_ip || undefined,
      userAgent: metadata.user_agent || undefined,
    },
  });
  if (!result.ok) {
    const mapped = emptyEpicDeleteError(result.error);
    if (mapped.code && mapped.children) {
      return NextResponse.json({ code: mapped.code, error: mapped.message, children: mapped.children }, { status: mapped.status });
    }
    if (result.error.code === "notFound") return apiError("Epic wurde nicht gefunden.", 404);
    if (result.error.code === "conflict" && result.error.reason === "revision") {
      return apiError("Epic wurde zwischenzeitlich geändert. Bitte neu laden.", 409);
    }
    return apiError(mapped.message, mapped.status);
  }
  const item = result.items[0];
  if (!item || item.kind !== "epic") return apiError("Epic konnte nicht gelöscht werden.", 500);
  return NextResponse.json({ ok: true, task: { id: item.id, taskType: "epic", updatedAt: item.updatedAt } });
}
