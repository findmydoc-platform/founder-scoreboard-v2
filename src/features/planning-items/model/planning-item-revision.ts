import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { codepointLength } from "@/lib/github-issue-content";
import { planningContentFromRow } from "./planning-item-content";
import { validateStoredPlanningContent } from "./planning-item-content-server";
import { resolveAdministratorAccessFailure, type AuthzResult } from "@/lib/authz";
import { activityMessages, buildTaskUpdateResponsePatch, profileId, type TaskUpdatePayload } from "@/features/tasks/model/task-mutation-contract";
import { taskAuditActionFromMessage } from "@/features/tasks/model/task-comment-timeline-policy";
import {
  applyReviewStatusUpdate, applyFinalStatusReopen, founderOwnedTaskUpdateFields,
  applyTaskBriefUpdateFields, applyTaskPriorityUpdate, applyTaskScoreUpdateFields,
  applyTaskSelfChecklistUpdateFields, applyTaskStatusUpdate, applyTaskTitleUpdate,
  markTaskGitHubSyncDirty, restrictedTaskUpdateFields, validateSubIssueStatusParentApproval,
  validateTaskTypeUpdateFields, validateTaskStatusUpdate, withoutUnchangedTaskStatus,
  type TaskRouteDbUpdate,
} from "@/features/tasks/model/task-route-update-helpers";
import { taskDetailPermissions } from "@/features/tasks/model/task-detail-permissions";
import { actorContextFromSessionAuth } from "./planning-actor-context-server";
import {
  buildPlanningItemUpdatePreview, parsePlanningItemPatchPayload, type PlanningItemUpdatePreview,
} from "./planning-item-update";
import type { PlanningError } from "./planning-items";
import { hasOperationalCorrection, type ActorContext } from "./actor-context";
import { backlogSprintAssignmentMessage, getBacklogSprintAssignmentEligibility } from "@/features/backlog/model/backlog-planning-state";
import { isOperationalLeadRole } from "@/lib/platform";
import { createNotificationPayload } from "@/lib/notification-catalog";
import { newlyMentionedProfilesByField } from "@/lib/mentions";
import { ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";
import { requireActivePlanningItem } from "@/lib/planning-trash-mutation-guard";
import type { Task, TaskActivity, AuthenticatedProfile } from "@/lib/types";
import { hasCompletedTaskChanges, hasReviewLockedTaskChanges, isTaskReviewActive, isTaskReviewLocked, reviewLockMessage, TASK_COMPLETED_LOCKED_MESSAGE } from "@/features/reviews/model/task-review-state";
import { normalizeEvidenceLinkList } from "@/features/tasks/model/task-evidence-links";
import { allowedPlanningItemStatuses } from "@/features/tasks/model/planning-item-capabilities";
import { mapTaskRow, type TaskRowForMapping } from "@/lib/planning-task-mappers";
import { normalizeFixedDate } from "./deliverable-schedule";

type BrowserRevisionInput = Readonly<{
  itemId: string;
  payload: Readonly<TaskUpdatePayload>;
  permission: Extract<AuthzResult, { ok: true }>;
}>;

type BrowserRevisionFailure = Readonly<{
  kind: "invalidCommand" | "forbidden" | "notFound" | "conflict" | "dependencyUnavailable";
  message: string;
  code?: Extract<AuthzResult, { ok: false }>["code"];
  lengthErrors?: Awaited<ReturnType<typeof validateStoredPlanningContent>>;
}>;

type BrowserRevisionResult =
  | Readonly<{ ok: true; value: { task: Partial<Task>; activities: TaskActivity[] } }>
  | Readonly<{ ok: false; error: BrowserRevisionFailure }>;

const failureKinds: Record<number, BrowserRevisionFailure["kind"]> = {
  400: "invalidCommand", 403: "forbidden", 404: "notFound",
  409: "conflict", 500: "dependencyUnavailable",
};

function browserFailure(
  message: string,
  status: number,
  details: Pick<BrowserRevisionFailure, "code" | "lengthErrors"> = {},
): Extract<BrowserRevisionResult, { ok: false }> {
  return { ok: false, error: { kind: failureKinds[status] || "dependencyUnavailable", message, ...details } };
}

function administratorFailure(failure: Extract<AuthzResult, { ok: false }>) {
  return browserFailure(failure.error, failure.status, { code: failure.code });
}

type PreparedRevision =
  | Readonly<{
    kind: "strategic";
    params: Readonly<{
      taskId: string;
      expectedUpdatedAt: string;
      patch: Record<string, unknown>;
      strategy: Record<string, unknown> | null;
      raciAssignments: readonly Record<string, unknown>[] | null;
      notifications: readonly Record<string, unknown>[];
    }>;
  }>
  | Readonly<{
    kind: "delivery";
    params: Readonly<{
      taskId: string;
      expectedUpdatedAt: string;
      taskPatch: Record<string, unknown>;
      notePresent: boolean;
      note: string | null;
      dependencyPresent: boolean;
      dependencyNote: string | null;
      activityMessages: readonly string[];
      notifications: readonly Record<string, unknown>[];
    }>;
  }>;

function reviseError(error: unknown): PlanningError {
  const code = error && typeof error === "object" && "code" in error ? String(error.code || "") : "";
  const message = error && typeof error === "object" && "message" in error ? String(error.message || "") : "";
  if (code === "P0001") return { code: "conflict", reason: "revision" };
  if (code === "P0003") return { code: "conflict", reason: "state", details: { reviseState: "trashed" } };
  if (code === "P0008") return { code: "conflict", reason: "state", details: { reviseState: "parentApproval" } };
  if (code === "P0010") return { code: "conflict", reason: "state", details: { reviseState: "reviewLocked" } };
  if (code === "P0015") return { code: "conflict", reason: "state", details: { reviseState: "sprintLocked" } };
  if (code === "P0016") return { code: "conflict", reason: "state", details: { reviseState: "completedLocked" } };
  if (code === "P0017") return { code: "invalidCommand", issues: [{ path: "command.changes.evidenceExceptionNote", reason: "reviewEvidenceRequired" }] };
  if (code === "P0002") return { code: "notFound", entity: { kind: "deliverable", id: "" } };
  if (code === "P0006") return { code: "forbidden", reason: "reviseNotAllowed" };
  if (code === "42501" && message.includes("active administrator access required")) {
    return { code: "forbidden", reason: "administratorAccessRequired" };
  }
  if (code === "42501") return { code: "forbidden", reason: "reviseNotAllowed" };
  if (code === "23503" && message.includes("RACI")) return { code: "invalidCommand", issues: [{ path: "command.changes.raciAssignments", reason: "profileNotFound" }] };
  if (code === "23505" && message.includes("RACI")) return { code: "invalidCommand", issues: [{ path: "command.changes.raciAssignments", reason: "assignmentDuplicated" }] };
  if (code === "22023" || code === "23514") return { code: "invalidCommand", issues: [{ path: "command.changes", reason: "persistenceValidation" }] };
  return { code: "dependencyUnavailable", dependency: "database", retryable: true };
}

async function commitRevision(supabase: SupabaseClient, actor: ActorContext, writer: PreparedRevision) {
  const administratorCorrection = hasOperationalCorrection(actor);
  const result = writer.kind === "strategic"
    ? await supabase.rpc(administratorCorrection ? "update_administrator_planning_item_transaction_v2" : "update_browser_planning_item_transaction_v2", {
      p_task_id: writer.params.taskId,
      p_expected_updated_at: writer.params.expectedUpdatedAt,
      p_patch: writer.params.patch,
      p_strategy: writer.params.strategy,
      p_raci_assignments: writer.params.raciAssignments,
      p_notifications: writer.params.notifications,
      ...(administratorCorrection ? {} : { p_actor_profile_id: actor.profileId }),
      p_request_ip: null,
      p_user_agent: null,
    })
    : await supabase.rpc(administratorCorrection ? "update_administrator_planning_task_transaction_v2" : "update_browser_planning_task_transaction_v2", {
      p_task_id: writer.params.taskId,
      p_expected_updated_at: writer.params.expectedUpdatedAt,
      p_task_patch: writer.params.taskPatch,
      p_note_present: writer.params.notePresent,
      p_note: writer.params.note,
      p_dependency_present: writer.params.dependencyPresent,
      p_dependency_note: writer.params.dependencyNote,
      p_activity_messages: writer.params.activityMessages,
      p_notifications: writer.params.notifications,
      ...(administratorCorrection ? {} : { p_actor_profile_id: actor.profileId }),
    });
  if (result.error) return { ok: false as const, error: reviseError(result.error) };
  return { ok: true as const, transaction: result.data as unknown };
}

export function createPlanningItemRevision(supabase: SupabaseClient) {
  return {
    commitBrowserRevision: (input: BrowserRevisionInput) => commitBrowserRevision(supabase, input),
    commitGitHubRevision: (input: GitHubRevisionInput) => commitGitHubRevision(supabase, input),
  };
}

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

function strategicText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function strategicDate(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) return undefined;
  return value;
}

async function commitBrowserRevision(
  supabase: SupabaseClient,
  { itemId: id, payload: inputPayload, permission }: BrowserRevisionInput,
): Promise<BrowserRevisionResult> {
  const operationalCorrection = permission.authority?.capabilities.operationalCorrection === true;
  const rawPayload = inputPayload;
  let payload = { ...inputPayload };
  const activeItem = await requireActivePlanningItem(supabase, id);
  if (!activeItem.ok) return browserFailure(activeItem.error, activeItem.status);
  if (!payload.expectedUpdatedAt || Number.isNaN(Date.parse(payload.expectedUpdatedAt))) {
    return browserFailure("Aktueller Aufgabenstand ist erforderlich.", 400);
  }
  const expectedUpdatedAt = payload.expectedUpdatedAt;
  const update: TaskRouteDbUpdate = {};
  let nextParentApprovalStatus: Task["parentApprovalStatus"] | undefined;
  let sprintAssignmentNoop = false;
  const { data: currentTask } = await supabase
    .from("tasks")
    .select("id,title,description,problem_statement,intended_outcome,scope_constraints,acceptance_criteria,evidence_required,definition_of_done,task_type,approval_status,approval_revision,assignee,owner,status,review_status,review_owner_profile_id,review_requested_at,review_evidence_exception_note,score_final,priority,sprint_id,score_relevant,parent_task_id,fixed_date,evidence_link,target_date,updated_at")
    .eq("id", id)
    .single();
  if (!currentTask) {
    return browserFailure("Aufgabe wurde nicht gefunden.", 404);
  }
  const reviseActor = actorContextFromSessionAuth(permission);
  if (!reviseActor.ok) return browserFailure("Aufgabenänderung ist nicht erlaubt.", 403);
  if (currentTask.task_type === "epic" || currentTask.task_type === "initiative") {
    const isOperationalLead = isOperationalLeadRole(permission.profile?.platformRole) || operationalCorrection;
    const ownsInitiative = currentTask.task_type === "initiative"
      && Boolean(permission.profile?.id)
      && (currentTask.assignee === permission.profile?.id || currentTask.owner === permission.profile?.id);
    if (currentTask.task_type === "epic" && !isOperationalLead) {
      return browserFailure("Epics können nur von CEO oder Deputy geändert werden.", 403);
    }
    if (currentTask.task_type === "initiative" && !isOperationalLead && !ownsInitiative) {
      return browserFailure("Nur CEO, Deputy oder der Initiative-Owner können diese Initiative ändern.", 403);
    }
    const allowedFields = new Set([
      "expectedUpdatedAt", "title", "description", "status", "ownerId", "priority",
      "targetDate", "parentTaskId", "strategy", "raciAssignments",
    ]);
    const unsupportedField = Object.keys(rawPayload).find((field) => !allowedFields.has(field));
    if (unsupportedField) return browserFailure(`Das Feld ${unsupportedField} ist für strategische Planungselemente nicht zulässig.`, 400);
    if (!isOperationalLead && (
      payload.parentTaskId !== undefined
      || payload.ownerId !== undefined
      || payload.raciAssignments !== undefined
    )) {
      return browserFailure("Parent, Owner und RACI können nur von CEO oder Deputy geändert werden.", 403);
    }
    if (payload.status !== undefined && !allowedPlanningItemStatuses(currentTask.task_type).includes(payload.status as never)) {
      return browserFailure("Ungültiger strategischer Status.", 400);
    }
    if (currentTask.task_type === "epic" && payload.priority !== undefined) {
      return browserFailure("Epics haben keine Priorität.", 400);
    }
    if (payload.priority !== undefined && !["P0", "P1", "P2", "P3", "P4"].includes(payload.priority)) {
      return browserFailure("Ungültige Priorität.", 400);
    }
    if (payload.title !== undefined && codepointLength(strategicText(payload.title)) < 3) {
      return browserFailure("Titel ist erforderlich.", 400);
    }
    const targetDate = strategicDate(payload.targetDate);
    if (targetDate === undefined) return browserFailure("Zieldatum ist ungültig.", 400);
    if (payload.strategy !== undefined && currentTask.task_type !== "initiative") {
      return browserFailure("Nur Initiativen haben eine Strategie.", 400);
    }
    if (payload.raciAssignments !== undefined && currentTask.task_type !== "initiative") {
      return browserFailure("Nur Initiativen haben RACI-Zuordnungen.", 400);
    }
    const patch: Record<string, string | number | null> = {};
    if (payload.title !== undefined) patch.title = strategicText(payload.title);
    if (payload.description !== undefined) patch.description = strategicText(payload.description) || null;
    if (payload.status !== undefined) patch.status = payload.status;
    if (payload.priority !== undefined) patch.priority = payload.priority;
    if (payload.ownerId !== undefined) {
      const assignee = profileId(payload.ownerId);
      if (!assignee) return browserFailure("Planungselemente brauchen eine Zuständigkeit.", 400);
      patch.assignee = assignee;
      patch.owner = assignee;
    }
    if (payload.targetDate !== undefined) patch.target_date = targetDate;
    if (payload.parentTaskId !== undefined) {
      if (currentTask.task_type !== "initiative") {
        return browserFailure("Epics haben keine übergeordnete Planungsebene.", 400);
      }
      patch.parent_task_id = profileId(payload.parentTaskId) || null;
    }
    const strategy = payload.strategy === undefined ? null : {
      goal: strategicText(payload.strategy.goal),
      successCriteria: strategicText(payload.strategy.successCriteria),
      scopeConstraints: strategicText(payload.strategy.scopeConstraints),
    };
    const raciAssignments = payload.raciAssignments === undefined ? null : payload.raciAssignments.map((assignment, index) => ({
      profileId: profileId(assignment.profileId),
      role: assignment.role,
      sortOrder: Number.isInteger(assignment.sortOrder) && (assignment.sortOrder || 0) >= 0 ? assignment.sortOrder : index,
    }));
    const [existingStrategyResult, existingRaciResult] = await Promise.all([
      currentTask.task_type === "initiative"
        ? supabase.from("planning_item_strategy").select("task_id,goal,success_criteria,scope_constraints").eq("task_id", id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      currentTask.task_type === "initiative"
        ? supabase.from("planning_item_raci_assignments").select("task_id,profile_id,role,sort_order").eq("task_id", id).order("sort_order")
        : Promise.resolve({ data: [], error: null }),
    ]);
    const lengthErrors = await validateStoredPlanningContent(supabase, {
      ...planningContentFromRow({ ...currentTask, ...patch }),
      intendedOutcome: strategy?.goal ?? existingStrategyResult.data?.goal ?? "", acceptanceCriteria: strategy?.successCriteria ?? existingStrategyResult.data?.success_criteria ?? "", scopeConstraints: strategy?.scopeConstraints ?? existingStrategyResult.data?.scope_constraints ?? "",
    });
    if (lengthErrors.length) return browserFailure(lengthErrors[0].message, 400, { lengthErrors });
    const profileResult = operationalCorrection
      ? await supabase.rpc("administrator_directory_snapshot")
      : await supabase.from("profiles").select("id,name,github_login");
    const profileRows = operationalCorrection
      ? (((profileResult.data || {}) as { people?: Array<{ id: string; name: string; githubLogin?: string }> }).people || []).map((profile) => ({
        id: profile.id,
        name: profile.name,
        github_login: profile.githubLogin || "",
      }))
      : (profileResult.data || []) as Array<{ id: string; name: string; github_login?: string | null }>;
    if (existingStrategyResult.error || existingRaciResult.error || profileResult.error) {
      return browserFailure("Planungselement konnte nicht vollständig geladen werden.", 500);
    }
    const strategicMentionFields = [
      ...(payload.description === undefined ? [] : [{ key: "description", previous: String(currentTask.description || ""), current: String(patch.description || "") }]),
      ...(payload.strategy === undefined ? [] : [
        { key: "strategy-goal", previous: String(existingStrategyResult.data?.goal || ""), current: strategy?.goal || "" },
        { key: "strategy-success", previous: String(existingStrategyResult.data?.success_criteria || ""), current: strategy?.successCriteria || "" },
        { key: "strategy-scope", previous: String(existingStrategyResult.data?.scope_constraints || ""), current: strategy?.scopeConstraints || "" },
      ]),
    ];
    const strategicProfiles = profileRows.map((profile) => ({
      id: profile.id,
      name: profile.name,
      githubLogin: profile.github_login || "",
    }));
    const strategicNotifications = newlyMentionedProfilesByField(strategicMentionFields, strategicProfiles).map((mention) => createNotificationPayload("task.mention", {
      actorProfileId: permission.profile?.id || null,
      recipientProfileId: mention.profileId,
      entityType: "task",
      entityId: id,
      title: `In einem Aufgabenfeld erwähnt: ${currentTask.title}`,
      body: mention.excerpt,
      dedupeKey: `task.mention:field:${id}:${mention.fieldKey}:${expectedUpdatedAt}:${mention.profileId}`,
      targetPath: `/tasks/${encodeURIComponent(id)}?focus=field:${mention.fieldKey}`,
    }));
    const result = await commitRevision(supabase, reviseActor.actor, {
      kind: "strategic",
      params: {
        taskId: id,
        expectedUpdatedAt,
        patch,
        strategy,
        raciAssignments,
        notifications: strategicNotifications,
      },
    });
    if (!result.ok) {
      if (operationalCorrection && result.error.code === "forbidden" && result.error.reason === "administratorAccessRequired") {
        return administratorFailure(await resolveAdministratorAccessFailure(supabase));
      }
      if (result.error.code === "conflict" && result.error.reason === "revision") return browserFailure("Planungselement wurde zwischenzeitlich geändert. Bitte neu laden.", 409);
      if (result.error.code === "notFound") return browserFailure("Planungselement wurde nicht gefunden.", 404);
      if (result.error.code === "invalidCommand") return browserFailure("Planungselement ist ungültig.", 400);
      if (result.error.code === "forbidden") return browserFailure("Planungselement konnte nicht geändert werden.", 403);
      return browserFailure("Planungselement konnte nicht gespeichert werden.", 500);
    }
    const transaction = result.transaction as { task?: TaskRowForMapping } | null;
    if (!transaction?.task) return browserFailure("Planungselement konnte nicht gespeichert werden.", 500);
    const updated = transaction.task;
    const profileNames = new Map(profileRows.map((profile) => [profile.id, profile.name]));
    const resultingStrategy = strategy
      ? {
          task_id: id,
          goal: String(strategy.goal || ""),
          success_criteria: String(strategy.successCriteria || ""),
          scope_constraints: String(strategy.scopeConstraints || ""),
        }
      : existingStrategyResult.data || undefined;
    const resultingRaciAssignments = raciAssignments
      ? raciAssignments.map((assignment) => ({
          task_id: id,
          profile_id: String(assignment.profileId || ""),
          role: assignment.role,
          sort_order: Number(assignment.sortOrder || 0),
        }))
      : existingRaciResult.data || [];
    return { ok: true, value: {
      activities: [],
      task: mapTaskRow(updated, profileNames, {
        strategy: resultingStrategy,
        raciAssignments: resultingRaciAssignments,
      }),
    } };
  }

  const taskTypeFieldGuard = validateTaskTypeUpdateFields(currentTask, payload);
  if (!taskTypeFieldGuard.ok) return browserFailure(taskTypeFieldGuard.error, taskTypeFieldGuard.status);
  if (payload.fixedDate !== undefined) {
    const fixedDate = normalizeFixedDate(payload.fixedDate);
    if (payload.fixedDate && !fixedDate) return browserFailure("Fixtermin ist ungültig.", 400);
    payload.fixedDate = fixedDate || "";
  }
  const hasEvidenceLinks = Object.prototype.hasOwnProperty.call(rawPayload, "evidenceLinks");
  const hasLegacyEvidenceLink = Object.prototype.hasOwnProperty.call(rawPayload, "evidenceLink");
  if (hasEvidenceLinks || hasLegacyEvidenceLink) {
    const normalizedEvidence = normalizeEvidenceLinkList(
      hasEvidenceLinks ? payload.evidenceLinks : [payload.evidenceLink ?? ""],
    );
    if (!normalizedEvidence.ok) return browserFailure(normalizedEvidence.error, 400);
    payload.evidenceLinks = normalizedEvidence.links;
    payload.evidenceLink = normalizedEvidence.links[0] || "";
  }
  const currentReviewState = { reviewStatus: currentTask.review_status, scoreFinal: Boolean(currentTask.score_final) } as Pick<Task, "reviewStatus" | "scoreFinal">;
  if (currentTask.status === "Erledigt" && hasCompletedTaskChanges(payload)) {
    return browserFailure(TASK_COMPLETED_LOCKED_MESSAGE, 409);
  }
  if (currentTask.task_type === "deliverable" && isTaskReviewLocked(currentReviewState) && hasReviewLockedTaskChanges(payload, { allowReviewOwnerChange: isTaskReviewActive(currentReviewState) })) {
    return browserFailure(reviewLockMessage(currentReviewState), 409);
  }
  if (currentTask.parent_task_id) {
    const { data: parentReviewState, error: parentReviewError } = await supabase
      .from(ACTIVE_TASKS_TABLE)
      .select("status,review_status,score_final")
      .eq("id", currentTask.parent_task_id)
      .maybeSingle();
    if (parentReviewError) return browserFailure(parentReviewError.message, 500);
    if (parentReviewState) {
      const parentReviewTask = { reviewStatus: parentReviewState.review_status, scoreFinal: Boolean(parentReviewState.score_final) } as Pick<Task, "reviewStatus" | "scoreFinal">;
      if (isTaskReviewLocked(parentReviewTask)) return browserFailure(reviewLockMessage(parentReviewTask), 409);
      if (parentReviewState.status === "Erledigt") return browserFailure(TASK_COMPLETED_LOCKED_MESSAGE, 409);
    }
  }
  const normalizedStatusUpdate = withoutUnchangedTaskStatus(currentTask, payload);
  payload = normalizedStatusUpdate.payload;
  const statusNoop = normalizedStatusUpdate.statusNoop;
  const isOperationalLead = isOperationalLeadRole(permission.profile?.platformRole) || operationalCorrection;
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
      status: currentTask.status || "",
      taskType: currentTask.task_type === "sub_issue" ? "sub_issue" : "deliverable",
    },
    profile: permission.profile,
    operationalCorrection,
  });

  if (!isOperationalLead && restrictedFields.length) {
    return browserFailure(`Diese Felder sind geschützt: ${restrictedFields.join(", ")}.`, 403);
  }

  if (!isOperationalLead && ownerFields.length && !detailPermissions.canEditBrief) {
    return browserFailure(`Founder können diese Felder nur bei eigenen Aufgaben ändern: ${ownerFields.join(", ")}.`, 403);
  }

  if (payload.reviewOwnerProfileId !== undefined && !canSetReviewOwner) {
    return browserFailure("Nur der CEO kann den Review Owner ändern.", 403);
  }
  if (currentTask.review_status === "requested" && payload.reviewOwnerProfileId !== undefined && !profileId(payload.reviewOwnerProfileId)) {
    return browserFailure("Ein aktives Review braucht eine Review-Verantwortung.", 400);
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
  if (!statusGuard.ok) return browserFailure(statusGuard.error, statusGuard.status);

  if (payload.status && currentTask.task_type === "sub_issue" && nextParentApprovalStatus === undefined) {
    let currentParent: { approval_status?: string | null; task_type?: string | null } | null = null;
    if (currentTask.parent_task_id) {
      const { data, error } = await supabase
        .from(ACTIVE_TASKS_TABLE)
        .select("id,task_type,approval_status")
        .eq("id", currentTask.parent_task_id)
        .maybeSingle();
      if (error) return browserFailure(error.message, 500);
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
  if (!parentStatusGuard.ok) return browserFailure(parentStatusGuard.error, parentStatusGuard.status);
  applyTaskStatusUpdate(update, payload);

  const priorityGuard = applyTaskPriorityUpdate(update, payload);
  if (!priorityGuard.ok) return browserFailure(priorityGuard.error, priorityGuard.status);

  const titleGuard = applyTaskTitleUpdate(update, payload);
  if (!titleGuard.ok) return browserFailure(titleGuard.error, titleGuard.status);

  if (payload.ownerId !== undefined) {
    const nextAssignee = profileId(payload.ownerId);
    if (!nextAssignee) return browserFailure("Aufgaben brauchen eine Zuständigkeit.", 400);
    update.assignee = nextAssignee || null;
    update.owner = nextAssignee || null;
  }

  applyTaskBriefUpdateFields(update, payload);
  if (payload.evidenceLinks !== undefined) {
    update.evidence_link = payload.evidenceLinks[0] || null;
    update.evidence_links = payload.evidenceLinks;
  }

  const lengthErrors = await validateStoredPlanningContent(supabase, planningContentFromRow({ ...currentTask, ...update }));
  if (lengthErrors.length) return browserFailure(lengthErrors[0].message, 400, { lengthErrors });

  if (payload.sprintId !== undefined) {
    const nextSprintId = payload.sprintId || null;
    const nextParentId = currentTask.parent_task_id || "";
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
    if (nextParentId) {
      const { data: initiative, error: initiativeError } = await supabase
        .from(ACTIVE_TASKS_TABLE)
        .select("id,task_type")
        .eq("id", nextParentId)
        .maybeSingle();
      if (initiativeError) return browserFailure(initiativeError.message, 500);
      hasInitiative = initiative?.task_type === "initiative";
    }

    let targetSprint: { id: string; scoreLocked: boolean } | null = null;
    if (nextSprintId) {
      const { data: sprint, error: sprintError } = await supabase
        .from("sprints")
        .select("id,score_locked")
        .eq("id", nextSprintId)
        .single();
      if (sprintError || !sprint) return browserFailure("Sprint wurde nicht gefunden.", 404);
      targetSprint = { id: sprint.id, scoreLocked: Boolean(sprint.score_locked) };
    }

    let sourceSprintLocked = false;
    if (currentTask.sprint_id && currentTask.sprint_id !== nextSprintId) {
      const { data: sourceSprint, error: sourceSprintError } = await supabase
        .from("sprints")
        .select("id,score_locked")
        .eq("id", currentTask.sprint_id)
        .maybeSingle();
      if (sourceSprintError) return browserFailure(sourceSprintError.message, 500);
      if (!sourceSprint) return browserFailure("Aktueller Sprint wurde nicht gefunden.", 409);
      sourceSprintLocked = Boolean(sourceSprint.score_locked);
    }

    const sprintEligibility = getBacklogSprintAssignmentEligibility({
      taskType: currentTask.task_type,
      approvalStatus: currentTask.approval_status,
      status: nextStatus,
      assignee: nextAssignee,
      owner: nextOwner,
      parentTaskId: nextParentId,
      hasInitiative,
      sprintId: currentTask.sprint_id,
    }, targetSprint, { sourceSprintLocked });
    if (!sprintEligibility.ok) {
      return browserFailure(backlogSprintAssignmentMessage(sprintEligibility.reason), 409);
    }
    if (sprintEligibility.action === "noop") {
      sprintAssignmentNoop = true;
    } else {
      update.sprint_id = nextSprintId;
      update.score_relevant = Boolean(nextSprintId);
    }
  }

  const reviewStatusGuard = applyReviewStatusUpdate(update, payload);
  if (!reviewStatusGuard.ok) return browserFailure(reviewStatusGuard.error, reviewStatusGuard.status);
  applyTaskScoreUpdateFields(update, payload);

  if (payload.reviewOwnerProfileId !== undefined && canSetReviewOwner) {
    const nextReviewOwner = profileId(payload.reviewOwnerProfileId);
    if (nextReviewOwner) {
      const { data: reviewOwner, error: reviewOwnerError } = await supabase
        .from("profiles")
        .select("id,platform_role")
        .eq("id", nextReviewOwner)
        .single();
      if (reviewOwnerError || !reviewOwner) return browserFailure("Review Owner wurde nicht gefunden.", 404);
      if (!reviewOwner.platform_role || reviewOwner.platform_role === "viewer") {
        return browserFailure("Die Review-Verantwortung braucht eine beitragende Rolle.", 400);
      }
    }
    update.review_owner_profile_id = nextReviewOwner || null;
  }

  applyFinalStatusReopen(update, currentTask, payload, isCeo, detailPermissions.canReopenSubIssue);

  applyTaskSelfChecklistUpdateFields(update, payload);
  markTaskGitHubSyncDirty(update);

  const messages = activityMessages(payload, currentTask);
  const mentionFieldDefinitions = [
    { payloadKey: "description", databaseKey: "description", fieldKey: "description" },
    { payloadKey: "problemStatement", databaseKey: "problem_statement", fieldKey: "problem" },
    { payloadKey: "intendedOutcome", databaseKey: "intended_outcome", fieldKey: "outcome" },
    { payloadKey: "scopeConstraints", databaseKey: "scope_constraints", fieldKey: "scope" },
    { payloadKey: "acceptanceCriteria", databaseKey: "acceptance_criteria", fieldKey: "acceptance" },
    { payloadKey: "evidenceRequired", databaseKey: "evidence_required", fieldKey: "evidence-required" },
    { payloadKey: "definitionOfDone", databaseKey: "definition_of_done", fieldKey: "definition-of-done" },
  ] as const;
  const changedMentionFields = mentionFieldDefinitions.flatMap((field) => payload[field.payloadKey] === undefined ? [] : [{
    key: field.fieldKey,
    previous: String(currentTask[field.databaseKey] || ""),
    current: String(payload[field.payloadKey] || "").trim(),
  }]);
  let mentionNotifications: ReturnType<typeof createNotificationPayload>[] = [];
  if (changedMentionFields.length) {
    const { data: mentionProfiles, error: mentionProfilesError } = await supabase
      .from("profiles")
      .select("id,name,github_login");
    if (mentionProfilesError) return browserFailure("Erwähnungen konnten nicht aufgelöst werden.", 500);
    const mentionProfileRows = (mentionProfiles || []).map((profile) => ({ id: profile.id, name: profile.name, githubLogin: profile.github_login }));
    mentionNotifications = newlyMentionedProfilesByField(changedMentionFields, mentionProfileRows).map((mention) => createNotificationPayload("task.mention", {
      actorProfileId: permission.profile?.id || null,
      recipientProfileId: mention.profileId,
      entityType: "task",
      entityId: id,
      title: `In einem Aufgabenfeld erwähnt: ${currentTask.title}`,
      body: mention.excerpt,
      dedupeKey: `task.mention:field:${id}:${mention.fieldKey}:${expectedUpdatedAt}:${mention.profileId}`,
      targetPath: `/tasks/${encodeURIComponent(id)}?focus=field:${mention.fieldKey}`,
    }));
  }

  if ((statusNoop || sprintAssignmentNoop) && Object.keys(update).length === 0 && payload.note === undefined && payload.dependsOn === undefined) {
    return { ok: true, value: {
      activities: [],
      task: {
        id,
        updatedAt: currentTask.updated_at,
        approvalStatus: currentTask.approval_status ?? null,
        approvalRevision: Number(currentTask.approval_revision || 1),
        sprintId: currentTask.sprint_id || "",
        scoreRelevant: Boolean(currentTask.score_relevant),
      },
    } };
  }

  const reviseResult = await commitRevision(supabase, reviseActor.actor, {
    kind: "delivery",
    params: {
      taskId: id,
      expectedUpdatedAt,
      taskPatch: update,
      notePresent: payload.note !== undefined,
      note: payload.note ?? null,
      dependencyPresent: payload.dependsOn !== undefined,
      dependencyNote: payload.dependsOn?.trim().slice(0, 2000) ?? null,
      activityMessages: [...new Set(messages)],
      notifications: mentionNotifications,
    },
  });
  if (!reviseResult.ok) {
    if (operationalCorrection && reviseResult.error.code === "forbidden" && reviseResult.error.reason === "administratorAccessRequired") {
      return administratorFailure(await resolveAdministratorAccessFailure(supabase));
    }
    if (reviseResult.error.code === "conflict" && reviseResult.error.reason === "revision") {
      return browserFailure("Aufgabe wurde zwischenzeitlich geändert. Bitte neu laden.", 409);
    }
    if (reviseResult.error.code === "conflict" && reviseResult.error.reason === "state") {
      if (reviseResult.error.details?.reviseState === "reviewLocked") {
        return browserFailure(reviewLockMessage({ reviewStatus: currentTask.review_status, scoreFinal: Boolean(currentTask.score_final) } as Pick<Task, "reviewStatus" | "scoreFinal">), 409);
      }
      if (reviseResult.error.details?.reviseState === "sprintLocked") {
        return browserFailure("Sprint-Zuordnung konnte nicht gespeichert werden. Bitte neu laden.", 409);
      }
      return browserFailure("Unter einem nicht freigegebenen Deliverable bleibt dieses Sub-Issue inaktiv.", 409);
    }
    if (reviseResult.error.code === "notFound") return browserFailure("Aufgabe wurde nicht gefunden.", 404);
    if (reviseResult.error.code === "invalidCommand") return browserFailure("Aufgabenänderung ist ungültig.", 400);
    if (reviseResult.error.code === "forbidden") return browserFailure("Aufgabenänderung ist nicht erlaubt.", 403);
    return browserFailure("Aufgabe konnte nicht gespeichert werden.", 500);
  }
  const result = reviseResult.transaction as TaskUpdateTransactionResult | null;
  if (!result?.task?.updated_at) return browserFailure("Aufgabe konnte nicht gespeichert werden.", 500);

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

  return { ok: true, value: {
    activities,
    task: taskPatch,
  } };
}

type GitHubRevisionInput = Readonly<{
  task: Readonly<{ id: string; updatedAt: string }>;
  actor: Readonly<{ profileId: string; name: string; platformRole: Exclude<ActorContext["platformRole"], "viewer"> }>;
  patch: Readonly<Record<string, unknown>>;
}>;

type GitHubRevisionResult =
  | Readonly<{ ok: true; status: "committed" | "unchanged" }>
  | Readonly<{ ok: false; error: PlanningError | { code: "rejected" } }>;

function githubRevisionPatch(
  preview: PlanningItemUpdatePreview,
) {
  const patch = { ...preview.dbPatch } as Record<string, unknown>;
  const effectColumns: Record<string, string> = {
    scoreFinal: "score_final",
    scorePoints: "score_points",
    reviewStatus: "review_status",
    reviewOwnerProfileId: "review_owner_profile_id",
    reviewRequestedAt: "review_requested_at",
    githubIssueSyncStatus: "github_issue_sync_status",
  };
  for (const effect of preview.systemEffects) {
    const column = effectColumns[effect.field];
    if (column) patch[column] = effect.after === "" ? null : effect.after;
  }
  if (preview.changedFields.length) {
    patch.github_issue_sync_status = "not_synced";
    patch.github_issue_sync_error = null;
  }
  return patch;
}

async function commitGitHubRevision(
  supabase: SupabaseClient,
  { task, actor: actorValue, patch }: GitHubRevisionInput,
): Promise<GitHubRevisionResult> {
  const parsed = parsePlanningItemPatchPayload(
    { expectedUpdatedAt: task.updatedAt, ...patch },
    { allowWebhookProjectionFields: true },
  );
  if (!parsed.ok) return { ok: false, error: { code: "rejected" } };
  const prepared = await buildPlanningItemUpdatePreview({
    actor: { id: actorValue.profileId, name: actorValue.name, platformRole: actorValue.platformRole } as AuthenticatedProfile,
    itemId: task.id,
    parsed,
    supabase,
  });
  if (!prepared.ok || prepared.preview.errors.length) return { ok: false, error: { code: "rejected" } };
  if (!prepared.preview.changedFields.length) return { ok: true, status: "unchanged" };
  const context: ActorContext = {
    profileId: actorValue.profileId,
    platformRole: actorValue.platformRole,
    credential: { kind: "session" },
  };
  const activities = prepared.preview.systemEffects.flatMap((effect) => {
    const after = effect.after && typeof effect.after === "object" && !Array.isArray(effect.after)
      ? effect.after as Record<string, unknown>
      : null;
    return effect.field === "activity" && typeof after?.message === "string" ? [after.message] : [];
  });
  const taskPatch = githubRevisionPatch(prepared.preview);
  if (prepared.preview.changedFields.includes("evidenceLink")) {
    const evidenceLink = strategicText(prepared.preview.normalizedPatch.evidenceLink);
    taskPatch.evidence_link = evidenceLink || null;
    taskPatch.evidence_links = evidenceLink ? [evidenceLink] : [];
  }
  const result = await commitRevision(supabase, context, {
    kind: "delivery",
    params: {
      taskId: task.id,
      expectedUpdatedAt: task.updatedAt,
      taskPatch,
      notePresent: false,
      note: null,
      dependencyPresent: false,
      dependencyNote: null,
      activityMessages: activities,
      notifications: [],
    },
  });
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, status: "committed" };
}
