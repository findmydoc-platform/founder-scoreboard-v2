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
  createPlanningReviewPlanningItems,
  isPlanningReviewRequestPayload,
  parsePlanningReviewRequestPayload,
  planningReviewActivitiesFromResult,
  planningReviewError,
  planningReviewTaskFromResult,
  requestPlanningReviewCommand,
} from "@/features/planning-items/model/planning-items-review";
import {
  backlogSprintAssignmentMessage,
  getBacklogSprintAssignmentEligibility,
} from "@/features/backlog/model/backlog-planning-state";
import { isOperationalLeadRole } from "@/lib/platform";
import { auditRequestMetadata } from "@/lib/api-input";
import { ACTIVE_PACKAGES_TABLE, ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";
import { requireActivePlanningItem } from "@/lib/planning-trash-mutation-guard";
import type { Task } from "@/lib/types";
import { hasReviewLockedTaskChanges, isTaskReviewActive, isTaskReviewLocked, reviewLockMessage } from "@/features/reviews/model/task-review-state";
import { normalizeEvidenceLinkList } from "@/features/tasks/model/task-evidence-links";
import { allowedPlanningItemStatuses } from "@/features/tasks/model/planning-item-capabilities";
import { mapTaskRow, type TaskRowForMapping } from "@/lib/planning-task-mappers";

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

function strategicText(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function strategicDate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) return undefined;
  return value;
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
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
  const activeItem = await requireActivePlanningItem(supabase, "tasks", id);
  if (!activeItem.ok) return apiError(activeItem.error, activeItem.status);
  if (!payload.expectedUpdatedAt || Number.isNaN(Date.parse(payload.expectedUpdatedAt))) {
    return apiError("Aktueller Aufgabenstand ist erforderlich.", 400);
  }
  const update: TaskRouteDbUpdate = {};
  let nextParentApprovalStatus: Task["parentApprovalStatus"] | undefined;
  let sprintAssignmentNoop = false;
  let usesLegacyInitiativeAlias = false;
  const { data: currentTask } = await supabase
    .from("tasks")
    .select("id,title,description,task_type,approval_status,approval_revision,assignee,owner,status,review_status,review_owner_profile_id,review_requested_at,score_final,priority,sprint_id,score_relevant,milestone_id,package_id,parent_task_id,start_date,end_date,deadline,evidence_link,target_date,updated_at")
    .eq("id", id)
    .single();
  if (!currentTask) {
    return apiError("Aufgabe wurde nicht gefunden.", 404);
  }
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
      "parentTaskId", "targetDate", "strategy", "raciAssignments",
    ]);
    const unsupportedField = Object.keys(rawPayload).find((field) => !allowedFields.has(field));
    if (unsupportedField) return apiError(`Das Feld ${unsupportedField} ist für strategische Planungselemente nicht zulässig.`, 400);
    if (!isOperationalLead && (payload.parentTaskId !== undefined || payload.assignee !== undefined || payload.owner !== undefined || payload.raciAssignments !== undefined)) {
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
    if (payload.parentTaskId !== undefined) patch.parent_task_id = payload.parentTaskId || null;
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
    const { data, error } = await supabase.rpc("update_planning_item_transaction", {
      p_task_id: id,
      p_expected_updated_at: payload.expectedUpdatedAt,
      p_patch: patch,
      p_strategy: strategy,
      p_raci_assignments: raciAssignments,
      p_actor_profile_id: permission.profile?.id || null,
    });
    const transaction = data as { task?: TaskRowForMapping } | null;
    if (error || !transaction?.task) {
      if (error?.code === "P0001") return apiError("Planungselement wurde zwischenzeitlich geändert. Bitte neu laden.", 409);
      if (error?.code === "P0002") return apiError("Planungselement wurde nicht gefunden.", 404);
      if (error?.code === "23514" || error?.code === "22023") return apiError(error.message || "Planungselement ist ungültig.", 400);
      return apiError(error?.message || "Planungselement konnte nicht gespeichert werden.", 500);
    }
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

  // packageId is retained as a deprecated request alias only.  It always
  // becomes the canonical parentTaskId and never writes package_id again.
  if (currentTask.task_type === "deliverable" && payload.packageId !== undefined && payload.parentTaskId === undefined) {
    const { packageId: legacyPackageId, ...withoutLegacyPackageId } = payload;
    payload = { ...withoutLegacyPackageId, parentTaskId: legacyPackageId || "" };
    usesLegacyInitiativeAlias = true;
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

  if (payload.parentTaskId !== undefined) {
    if (currentTask.task_type !== "sub_issue" && currentTask.task_type !== "deliverable") {
      return apiError("Dieses Planungselement kann keinem anderen Parent zugeordnet werden.", 400);
    }
    if (currentTask.task_type === "sub_issue" && !detailPermissions.canReparentSubIssue) {
      return apiError("Nur CEO, Deputy oder die aktuelle Zuständigkeit können dieses Sub-Issue verschieben.", 403);
    }
    if (currentTask.task_type === "deliverable" && !isOperationalLead) {
      return apiError("Deliverables können nur von CEO oder Deputy einer Initiative zugeordnet werden.", 403);
    }

    const nextParentTaskId = payload.parentTaskId.trim();
    if (currentTask.task_type === "sub_issue" && !nextParentTaskId) {
      return apiError("Ein Parent-Deliverable ist erforderlich.", 400);
    }
    if (nextParentTaskId) {
      const { data: nextParent, error: nextParentError } = await supabase
        .from(ACTIVE_TASKS_TABLE)
        .select("id,task_type,approval_status")
        .eq("id", nextParentTaskId)
        .maybeSingle();
      if (nextParentError) return apiError(nextParentError.message, 500);
      if (!nextParent) return apiError("Übergeordnetes Planungselement wurde nicht gefunden.", 404);
      const requiredParentType = currentTask.task_type === "sub_issue" ? "deliverable" : "initiative";
      if (nextParent.task_type !== requiredParentType) {
        return apiError(currentTask.task_type === "sub_issue"
          ? "Sub-Issues können nur unter Deliverables verschoben werden."
          : "Deliverables können nur unter Initiativen eingeordnet werden.", 400);
      }
      nextParentApprovalStatus = nextParent.approval_status as Task["parentApprovalStatus"];
    }
    if (nextParentTaskId !== currentTask.parent_task_id) update.parent_task_id = nextParentTaskId || null;
  }

  if (payload.parentTaskId !== undefined && update.parent_task_id !== undefined) {
    const additionalFields = Object.keys(rawPayload).filter((field) => ![
      "expectedUpdatedAt",
      "parentTaskId",
      ...(usesLegacyInitiativeAlias ? ["packageId"] : []),
    ].includes(field));
    if (additionalFields.length) {
      return apiError("Ändere die übergeordnete Planungsebene separat von weiteren Feldern.", 409);
    }
    const { data, error } = await supabase.rpc("reparent_planning_item_transaction", {
      p_task_id: id,
      p_expected_updated_at: payload.expectedUpdatedAt,
      p_parent_task_id: typeof update.parent_task_id === "string" ? update.parent_task_id : null,
      p_actor_profile_id: permission.profile?.id || null,
    });
    const transaction = data as { task?: {
      updated_at?: string;
      approval_status?: Task["approvalStatus"];
      approval_revision?: number;
      parent_task_id?: string | null;
      package_id?: string | null;
      milestone_id?: string | null;
      github_issue_sync_status?: Task["githubIssueSyncStatus"];
      github_issue_sync_error?: string | null;
    } } | null;
    if (error || !transaction?.task?.updated_at) {
      if (error?.code === "P0001") return apiError("Planungselement wurde zwischenzeitlich geändert. Bitte neu laden.", 409);
      if (error?.code === "23514" || error?.code === "22023") return apiError(error.message || "Übergeordnete Planungsebene ist ungültig.", 400);
      return apiError(error?.message || "Zuordnung konnte nicht gespeichert werden.", 500);
    }
    return NextResponse.json({
      ok: true,
      activities: [],
      task: {
        id,
        parentTaskId: transaction.task.parent_task_id || "",
        packageId: transaction.task.package_id || "",
        milestoneId: transaction.task.milestone_id || "",
        parentApprovalStatus: nextParentApprovalStatus ?? null,
        approvalStatus: transaction.task.approval_status ?? null,
        approvalRevision: Number(transaction.task.approval_revision || 1),
        githubIssueSyncStatus: transaction.task.github_issue_sync_status || "not_synced",
        githubIssueSyncError: transaction.task.github_issue_sync_error || "",
        updatedAt: transaction.task.updated_at,
      },
    });
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

  if (payload.milestoneId !== undefined) {
    // Epic is derived from the canonical parent chain.  Accept a matching
    // legacy value during the transition, but reject a competing hierarchy.
    if ((payload.milestoneId || "") !== (currentTask.milestone_id || "")) {
      return apiError("Der Epic-Bezug wird über die Initiative abgeleitet. Ändere stattdessen den Parent.", 400);
    }
  }

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
        .from(ACTIVE_PACKAGES_TABLE)
        .select("id")
        .eq("id", nextPackageId)
        .maybeSingle();
      if (initiativeError) return apiError(initiativeError.message, 500);
      hasInitiative = Boolean(initiative);
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
      packageId: nextPackageId,
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

  const { data: transactionData, error: transactionError } = await supabase.rpc("update_planning_task_transaction", {
    p_task_id: id,
    p_expected_updated_at: payload.expectedUpdatedAt,
    p_task_patch: update,
    p_note_present: payload.note !== undefined,
    p_note: payload.note ?? null,
    p_dependency_present: payload.dependsOn !== undefined,
    p_dependency_note: payload.dependsOn?.trim().slice(0, 2000) ?? null,
    p_activity_messages: [...new Set(messages)],
    p_notifications: [],
    p_actor_profile_id: permission.profile?.id || null,
  });

  if (transactionError) {
    if (transactionError.code === "P0001") {
      return apiError("Aufgabe wurde zwischenzeitlich geändert. Bitte neu laden.", 409);
    }
    if (transactionError.code === "P0008") {
      return apiError("Unter einem nicht freigegebenen Deliverable bleibt dieses Sub-Issue inaktiv.", 409);
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
