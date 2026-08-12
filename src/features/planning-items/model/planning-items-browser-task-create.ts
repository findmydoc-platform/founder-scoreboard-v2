import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { requirePlanningContributor } from "@/lib/authz";
import { mapTaskRow, type TaskRowForMapping } from "@/lib/planning-task-mappers";
import { slugify } from "@/lib/slug";
import { taskStatuses } from "@/lib/status";
import { buildTaskInsertRow } from "@/lib/task-insert-row";
import type { PlanningItemRaciAssignment, Task, TaskRelation, TaskRelationType, TaskType } from "@/lib/types";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { createNotificationPayload } from "@/lib/notification-catalog";
import { resolveTaskGitHubRepository } from "@/lib/github-repositories";
import { ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";
import { isReviewStateLocked, reviewStateLockMessage } from "@/features/reviews/model/task-review-state";
import { unsupportedSubIssueCreateField } from "@/features/tasks/model/task-creation-draft";
import { isOperationalLeadRole } from "@/lib/platform";
import { allowedPlanningItemStatuses } from "@/features/tasks/model/planning-item-capabilities";
import { actorContextFromSessionAuth } from "@/features/planning-items/model/planning-actor-context-server";
import {
  browserCreateTransactionFromResult,
  createBrowserCreatePlanningItems,
  planningItemCreateCommand,
} from "@/features/planning-items/model/planning-items-create";
import {
  createPlanningApprovalPlanningItems,
  decidePlanningApprovalCommand,
  planningApprovalTaskFromResult,
} from "@/features/planning-items/model/planning-items-approval";

type CreateTaskPayload = {
  title?: string;
  description?: string;
  problemStatement?: string;
  intendedOutcome?: string;
  scopeConstraints?: string;
  acceptanceCriteria?: string;
  evidenceRequired?: string;
  taskType?: TaskType;
  parentTaskId?: string;
  packageId?: string;
  milestoneId?: string;
  sprintId?: string;
  assignee?: string;
  owner?: string;
  priority?: string;
  status?: string;
  workstream?: string;
  startDate?: string;
  endDate?: string;
  deadline?: string;
  hours?: number;
  definitionOfDone?: string;
  creationRequestId?: string;
  relationType?: TaskRelationType;
  relatedTaskId?: string;
  relationNote?: string;
  approveNow?: boolean;
  githubRepo?: string;
  targetDate?: string;
  strategy?: {
    goal?: string;
    successCriteria?: string;
    scopeConstraints?: string;
  };
  raciAssignments?: Array<{
    profileId?: string;
    role?: PlanningItemRaciAssignment["role"];
    sortOrder?: number;
  }>;
};

const taskTypes = new Set<TaskType>(["epic", "initiative", "deliverable", "sub_issue"]);
const priorities = new Set(["P0", "P1", "P2", "P3", "P4"]);
const relationTypes = new Set<TaskRelationType>(["blocked_by", "blocks", "relates_to"]);
type CreateTaskTransactionResult = {
  task?: TaskRowForMapping;
  relatedTask?: Partial<Task> & { id: string };
  relation?: {
    id: number;
    task_id: string;
    related_task_id: string;
    relation_type: TaskRelationType;
    note?: string | null;
    created_by?: string | null;
    created_at: string;
  } | null;
};

function relationActionLabel(type: TaskRelationType) {
  if (type === "blocked_by") return "Wartet auf";
  if (type === "blocks") return "Blockiert";
  return "Verknüpft mit";
}

function profileId(value?: string) {
  return slugify(value || "");
}

function validIsoDate(value?: string) {
  if (!value) return "";
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
    ? value
    : "";
}

export async function handleBrowserTaskCreate(request: NextRequest) {
  const context = await requireJsonApiContext<CreateTaskPayload>(request, requirePlanningContributor, {});
  if (!context.ok) return context.response;

  const { payload, permission, supabase } = context;
  const title = cleanText(payload.title, 240);
  if (title.length < 3) return apiError("Titel ist erforderlich.", 400);
  const creationRequestId = cleanText(payload.creationRequestId, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(creationRequestId)) {
    return apiError("Erstellungsanfrage ist ungültig. Bitte Dialog neu öffnen.", 400);
  }

  const requestedType = payload.taskType || "deliverable";
  if (!taskTypes.has(requestedType)) return apiError("Ungültiger Aufgabentyp.", 400);
  const isStrategic = requestedType === "epic" || requestedType === "initiative";
  if (isStrategic) {
    if (!isOperationalLeadRole(permission.profile?.platformRole)) {
      return apiError(requestedType === "epic" ? "Epics können nur von CEO oder Deputy erstellt werden." : "Initiativen können nur von CEO oder Deputy erstellt werden.", 403);
    }
    if (payload.approveNow) return apiError("Strategische Planungselemente werden nicht direkt beim Erstellen freigegeben.", 400);
    const status = payload.status && allowedPlanningItemStatuses(requestedType).includes(payload.status as never)
      ? payload.status
      : "Offen";
    const targetDate = validIsoDate(payload.targetDate);
    if (payload.targetDate && !targetDate) return apiError("Zieldatum ist ungültig.", 400);
    const idBase = `${permission.profile?.id || "planning"}-${slugify(title, { maxLength: 70 }) || "neues-planungselement"}`;
    const id = `${idBase}-${creationRequestId.replaceAll("-", "").slice(0, 12)}`;
    const owner = profileId(payload.owner || payload.assignee) || permission.profile?.id || "";
    const suppliedRaciAssignments = (payload.raciAssignments || []).map((assignment, index) => ({
      profileId: profileId(assignment.profileId),
      role: assignment.role,
      sortOrder: Number.isInteger(assignment.sortOrder) && (assignment.sortOrder || 0) >= 0
        ? assignment.sortOrder
        : index,
    }));
    const raciAssignments = requestedType === "initiative" && suppliedRaciAssignments.length === 0 && owner
      ? [
          { profileId: owner, role: "accountable" as const, sortOrder: 0 },
          { profileId: owner, role: "responsible" as const, sortOrder: 1 },
        ]
      : suppliedRaciAssignments;
    const strategicItem = {
        id,
        project_id: "findmydoc-founder-execution",
        task_type: requestedType,
        title,
        description: cleanText(payload.description, 4000),
        status,
        priority: requestedType === "initiative" && payload.priority && priorities.has(payload.priority) ? payload.priority : "P2",
        owner,
        assignee: owner,
        parent_task_id: payload.parentTaskId || null,
        target_date: targetDate || null,
        sort_order: 0,
      };
    const strategicStrategy = requestedType === "initiative" ? {
        goal: cleanText(payload.strategy?.goal || payload.intendedOutcome, 4000),
        successCriteria: cleanText(payload.strategy?.successCriteria || payload.acceptanceCriteria, 6000),
        scopeConstraints: cleanText(payload.strategy?.scopeConstraints || payload.scopeConstraints, 4000),
      } : null;
    const actor = actorContextFromSessionAuth({ ok: true, profile: permission.profile });
    if (!actor.ok) return apiError("Planungselement konnte nicht erstellt werden.", 500);
    const planningItems = createBrowserCreatePlanningItems({
      supabase,
      actor: actor.actor,
      writer: {
        kind: "strategic",
        params: {
          item: strategicItem,
          strategy: strategicStrategy,
          raciAssignments: requestedType === "initiative" ? raciAssignments : [],
        },
      },
    });
    const result = await planningItems.run({
      actor: actor.actor,
      mode: "commit",
      command: planningItemCreateCommand([{
        itemType: requestedType,
        title,
        description: strategicItem.description,
        ownerId: owner,
        parentTaskId: payload.parentTaskId,
        priority: strategicItem.priority,
        targetDate,
        status,
        intendedOutcome: strategicStrategy?.goal,
        acceptanceCriteria: strategicStrategy?.successCriteria,
        scopeConstraints: strategicStrategy?.scopeConstraints,
        accountableProfileId: raciAssignments.find((assignment) => assignment.role === "accountable")?.profileId,
        responsibleProfileIds: raciAssignments.filter((assignment) => assignment.role === "responsible").map((assignment) => assignment.profileId),
        consultedProfileIds: raciAssignments.filter((assignment) => assignment.role === "consulted").map((assignment) => assignment.profileId),
        informedProfileIds: raciAssignments.filter((assignment) => assignment.role === "informed").map((assignment) => assignment.profileId),
      }], actor.actor.profileId),
    });
    if (!result.ok) {
      if (result.error.code === "conflict") return apiError("Planungselement existiert bereits.", 409);
      if (result.error.code === "invalidCommand") return apiError("Planungselement ist ungültig.", 400);
      return apiError("Planungselement konnte nicht erstellt werden.", 500);
    }
    const transaction = browserCreateTransactionFromResult(result) as { task?: TaskRowForMapping } | null;
    if (!transaction?.task) return apiError("Planungselement konnte nicht erstellt werden.", 500);
    const created = transaction.task;
    const profileIds = [created.assignee, created.owner, created.created_by]
      .filter((value): value is string => typeof value === "string" && Boolean(value));
    const { data: profileRows } = profileIds.length
      ? await supabase.from("profiles").select("id,name").in("id", [...new Set(profileIds)])
      : { data: [] };
    const profileNameById = new Map((profileRows || []).map((profile: { id: string; name: string }) => [profile.id, profile.name]));
    return NextResponse.json({
      ok: true,
      task: mapTaskRow(created, profileNameById, {
        strategy: requestedType === "initiative" ? {
          task_id: id,
          goal: cleanText(payload.strategy?.goal || payload.intendedOutcome, 4000),
          success_criteria: cleanText(payload.strategy?.successCriteria || payload.acceptanceCriteria, 6000),
          scope_constraints: cleanText(payload.strategy?.scopeConstraints || payload.scopeConstraints, 4000),
        } : undefined,
        raciAssignments: requestedType === "initiative" ? raciAssignments.map((assignment) => ({
          task_id: id,
          profile_id: assignment.profileId,
          role: assignment.role || "responsible",
          sort_order: assignment.sortOrder ?? 0,
        })) : [],
      }),
      relation: null,
      relatedTask: null,
    });
  }
  if (requestedType === "sub_issue") {
    const forbiddenField = unsupportedSubIssueCreateField(payload as Record<string, unknown>);
    if (forbiddenField) {
      return apiError(`Das Feld ${forbiddenField} ist für Sub-Issues nicht zulässig.`, 400);
    }
  }
  const githubRepository = resolveTaskGitHubRepository(requestedType, payload.githubRepo);
  if (!githubRepository.ok) return apiError(githubRepository.error, 400);

  const isCeo = permission.profile?.platformRole === "ceo";
  if (payload.approveNow && !isCeo) return apiError("Nur der CEO kann beim Erstellen direkt freigeben.", 403);
  const packageId = payload.packageId || null;
  let parentApprovalStatus: Task["parentApprovalStatus"] = null;
  let initiative: { id: string; milestone_id: string | null; owner?: string | null; approval_status?: string | null } | null = null;
  const startDate = payload.startDate || null;
  const endDate = payload.endDate || null;

  if (startDate && endDate && startDate > endDate) {
    return apiError("Das Startdatum darf nicht nach dem Enddatum liegen.", 400);
  }

  const taskType: TaskType = requestedType;
  const scoreRelevant = false;
  const status = taskType === "sub_issue"
    ? "Offen"
    : payload.status && taskStatuses.includes(payload.status as (typeof taskStatuses)[number]) ? payload.status : "Offen";
  const priority = taskType === "sub_issue"
    ? "P2"
    : payload.priority && priorities.has(payload.priority) ? payload.priority : "P2";
  const assignee = profileId(payload.assignee || payload.owner) || permission.profile?.id || null;
  let parentTaskId = taskType === "sub_issue" || taskType === "deliverable" ? payload.parentTaskId || "" : "";

  if (taskType === "deliverable" && !parentTaskId && packageId) {
    const { data: canonicalParent, error: canonicalParentError } = await supabase
      .from(ACTIVE_TASKS_TABLE)
      .select("id,task_type")
      .eq("id", packageId)
      .maybeSingle();
    if (canonicalParentError) return apiError(canonicalParentError.message, 500);
    if (canonicalParent?.task_type === "initiative") {
      parentTaskId = canonicalParent.id;
    } else {
      const { data: legacyParent, error: legacyParentError } = await supabase
      .from("planning_item_legacy_ids")
      .select("task_id")
      .eq("source_kind", "package")
      .eq("legacy_id", packageId)
      .maybeSingle();
      if (legacyParentError) return apiError(legacyParentError.message, 500);
      parentTaskId = legacyParent?.task_id || "";
    }
  }

  if (taskType === "deliverable" && parentTaskId) {
    const { data: initiativeRow, error: initiativeError } = await supabase
      .from(ACTIVE_TASKS_TABLE)
      .select("id,milestone_id,owner,approval_status,task_type")
      .eq("id", parentTaskId)
      .maybeSingle();
    if (initiativeError || !initiativeRow || initiativeRow.task_type !== "initiative") {
      return apiError("Initiative wurde nicht gefunden.", 404);
    }
    initiative = initiativeRow;
    parentApprovalStatus = (initiative.approval_status as Task["parentApprovalStatus"]) || null;
  }

  let reviewOwnerProfileId: string | null = null;
  if (taskType === "deliverable" && initiative) {
    const { data: accountable, error: accountableError } = await supabase
      .from("planning_item_raci_assignments")
      .select("profile_id")
      .eq("task_id", initiative.id)
      .eq("role", "accountable")
      .maybeSingle();
    if (accountableError) return apiError(accountableError.message, 500);
    reviewOwnerProfileId = accountable?.profile_id || initiative.owner || null;
  }

  if (taskType === "deliverable" && initiative?.approval_status === "rejected") {
    return apiError("In einer abgelehnten Initiative können keine Deliverables vorgeschlagen werden.", 409);
  }
  if (taskType === "deliverable" && payload.approveNow && initiative?.approval_status !== "approved") {
    return apiError("Die Initiative muss vor dem Deliverable freigegeben sein.", 409);
  }

  if (taskType === "sub_issue" && !parentTaskId) {
    return apiError("Sub-Issue braucht ein Deliverable.", 400);
  }
  if (taskType === "sub_issue") {
    const { data: parent, error: parentError } = await supabase
      .from(ACTIVE_TASKS_TABLE)
      .select("id,title,task_type,package_id,milestone_id,approval_status,review_status,score_final")
      .eq("id", parentTaskId)
      .single();
    if (parentError || !parent || parent.task_type !== "deliverable") return apiError("Deliverable wurde nicht gefunden.", 404);
    if (isReviewStateLocked(parent.review_status, parent.score_final)) {
      return apiError(reviewStateLockMessage(parent.review_status, parent.score_final), 409);
    }
    parentApprovalStatus = (parent.approval_status as Task["parentApprovalStatus"]) || null;
  }

  const relatedTaskId = cleanText(payload.relatedTaskId, 240);
  const relationType = payload.relationType;
  const relationNote = cleanText(payload.relationNote, 500);
  if (relatedTaskId) {
    if (!relationType || !relationTypes.has(relationType)) {
      return apiError("Ungültige Abhängigkeitsart.", 400);
    }
    const { data: relatedTask, error: relatedTaskError } = await supabase
      .from(ACTIVE_TASKS_TABLE)
      .select("id")
      .eq("id", relatedTaskId)
      .maybeSingle();
    if (relatedTaskError || !relatedTask) return apiError("Verknüpfte Aufgabe wurde nicht gefunden.", 404);
  }

  const idBase = `${permission.profile?.id || "task"}-${slugify(title, { maxLength: 70 }) || "neue-aufgabe"}`;
  const id = `${idBase}-${creationRequestId.replaceAll("-", "").slice(0, 12)}`;

  const insert = buildTaskInsertRow({
    id,
    creationRequestId,
    // parent_task_id is canonical. package_id and milestone_id remain
    // trigger-derived legacy comparison fields after the cutover.
    title,
    description: cleanText(payload.description, 4000),
    problemStatement: cleanText(payload.problemStatement, 4000),
    intendedOutcome: cleanText(payload.intendedOutcome, 4000),
    scopeConstraints: cleanText(payload.scopeConstraints, 4000),
    acceptanceCriteria: cleanText(payload.acceptanceCriteria, 6000),
    evidenceRequired: cleanText(payload.evidenceRequired, 4000),
    status,
    priority,
    owner: assignee,
    assignee,
    createdBy: permission.profile?.id || null,
    workstream: taskType === "sub_issue" ? "" : cleanText(payload.workstream, 120),
    sortOrder: 0,
    startDate: taskType === "sub_issue" ? null : startDate,
    endDate: taskType === "sub_issue" ? null : endDate,
    deadline: taskType === "sub_issue" ? null : payload.deadline || null,
    hours: taskType === "sub_issue" ? 0 : Math.max(0, Math.min(200, Math.round(Number(payload.hours || 0)))),
    definitionOfDone: cleanText(payload.definitionOfDone, 4000),
    sprintId: null,
    reviewOwnerProfileId,
    taskType,
    parentTaskId,
    scoreRelevant,
    githubRepo: githubRepository.repository,
  });

  const notifications: Array<Record<string, string | null>> = [];
  if (taskType === "deliverable" && !payload.approveNow) {
    const { data: leads, error: leadError } = await supabase
      .from("profiles")
      .select("id")
      .in("platform_role", ["ceo", "deputy"]);
    if (leadError) return apiError(leadError.message, 500);
    notifications.push(...(leads || [])
      .filter((lead) => lead.id !== permission.profile?.id)
      .map((lead) => createNotificationPayload("task.proposed", {
        actorProfileId: permission.profile?.id,
        recipientProfileId: lead.id,
        entityType: "task",
        entityId: id,
        title: `Deliverable vorgeschlagen: ${title}`,
        body: insert.description || "Ein neues Deliverable wartet auf Freigabe.",
      })));
  }

  const activityMessage = taskType === "sub_issue"
      ? "Sub-Issue erstellt"
      : "Deliverable vorgeschlagen";
  const requestMetadata = auditRequestMetadata(request);
  const actor = actorContextFromSessionAuth({ ok: true, profile: permission.profile });
  if (!actor.ok) return apiError("Aufgabe konnte nicht erstellt werden.", 500);
  const planningItems = createBrowserCreatePlanningItems({
    supabase,
    actor: actor.actor,
    writer: {
      kind: "delivery",
      params: {
        taskInsert: insert,
        relationType: relatedTaskId ? relationType || null : null,
        relatedTaskId: relatedTaskId || null,
        relationNote: relationNote || null,
        activityMessage,
        relationActivityMessage: relatedTaskId && relationType ? `Abhängigkeit hinzugefügt: ${relationActionLabel(relationType)}` : null,
        notifications,
        approveNow: false,
      },
    },
  });
  const createResult = await planningItems.run({
    actor: actor.actor,
    mode: "commit",
    command: planningItemCreateCommand([{
      itemType: taskType,
      title,
      description: payload.description,
      problemStatement: payload.problemStatement,
      intendedOutcome: payload.intendedOutcome,
      scopeConstraints: payload.scopeConstraints,
      acceptanceCriteria: payload.acceptanceCriteria,
      evidenceRequired: payload.evidenceRequired,
      definitionOfDone: payload.definitionOfDone,
      parentTaskId,
      ownerId: assignee,
      priority,
      workstream: payload.workstream,
      startDate,
      endDate,
      deadline: payload.deadline,
      hours: payload.hours,
      githubRepo: payload.githubRepo,
      status,
    }], actor.actor.profileId),
    requestMetadata: { requestIp: requestMetadata.request_ip || undefined, userAgent: requestMetadata.user_agent || undefined },
  });
  if (!createResult.ok) {
    if (createResult.error.code === "notFound") return apiError("Verknüpfte Aufgabe wurde nicht gefunden.", 404);
    if (createResult.error.code === "conflict" && createResult.error.reason === "idempotency") {
      return apiError("Erstellungsanfrage wurde mit geänderten Daten wiederholt. Bitte Dialog neu öffnen.", 409);
    }
    if (createResult.error.code === "invalidCommand") return apiError("Aufgabe oder Abhängigkeit ist ungültig.", 400);
    if (createResult.error.code === "conflict") return apiError("Aufgabe oder Abhängigkeit existiert bereits.", 409);
    return apiError("Aufgabe konnte nicht erstellt werden.", 500);
  }

  const transaction = browserCreateTransactionFromResult(createResult) as CreateTaskTransactionResult | null;
  const created = transaction?.task;
  if (!created?.id) return apiError("Aufgabe konnte nicht erstellt werden.", 500);

  let approvedTask: Task | null = null;
  if (taskType === "deliverable" && payload.approveNow) {
    const approval = await createPlanningApprovalPlanningItems(supabase, "deliverable").run({
      actor: actor.actor,
      mode: "commit",
      command: decidePlanningApprovalCommand(created.id, {
        expectedApprovalRevision: Number(created.approval_revision || 1),
        action: "approve",
        note: "Bei Erstellung durch CEO freigegeben.",
      }),
    });
    if (!approval.ok) return apiError("Deliverable konnte nicht freigegeben werden.", 400);
    approvedTask = planningApprovalTaskFromResult(approval);
  }

  const profileIds = [...new Set([created.assignee, created.owner, created.created_by].filter((value): value is string => typeof value === "string" && Boolean(value)))];
  const { data: profileRows } = profileIds.length
    ? await supabase.from("profiles").select("id,name").in("id", profileIds)
    : { data: [] };
  const profileNameById = new Map((profileRows || []).map((profile: { id: string; name: string }) => [profile.id, profile.name]));

  const task: Task = approvedTask || mapTaskRow(created as TaskRowForMapping, profileNameById);
  if (task.parentTaskId) task.parentApprovalStatus = parentApprovalStatus;
  const relation: TaskRelation | null = transaction?.relation
    ? {
        id: transaction.relation.id,
        taskId: transaction.relation.task_id,
        relatedTaskId: transaction.relation.related_task_id,
        relationType: transaction.relation.relation_type,
        note: transaction.relation.note || "",
        createdBy: transaction.relation.created_by || "",
        createdAt: transaction.relation.created_at,
      }
    : null;

  return NextResponse.json({ ok: true, task, relation, relatedTask: transaction?.relatedTask || null });
}
