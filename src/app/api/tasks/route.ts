import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { requirePlanningContributor } from "@/lib/authz";
import { mapTaskRow, type TaskRowForMapping } from "@/lib/planning-task-mappers";
import { slugify } from "@/lib/slug";
import { taskStatuses } from "@/lib/status";
import { buildTaskInsertRow } from "@/lib/task-insert-row";
import type { Task, TaskRelation, TaskRelationType, TaskType } from "@/lib/types";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { createNotificationPayload } from "@/lib/notification-catalog";
import { resolveTaskGitHubRepository } from "@/lib/github-repositories";
import { ACTIVE_PACKAGES_TABLE, ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";

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
};

const taskTypes = new Set<TaskType>(["deliverable", "sub_issue"]);
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

export async function POST(request: NextRequest) {
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
  const githubRepository = resolveTaskGitHubRepository(requestedType, payload.githubRepo);
  if (!githubRepository.ok) return apiError(githubRepository.error, 400);

  const isCeo = permission.profile?.platformRole === "ceo";
  if (payload.approveNow && !isCeo) return apiError("Nur der CEO kann beim Erstellen direkt freigeben.", 403);
  const packageId = payload.packageId || null;
  let effectivePackageId = packageId;
  let parentApprovalStatus: Task["parentApprovalStatus"] = null;
  let milestoneId = payload.milestoneId || null;
  let initiative: { id: string; milestone_id: string | null; owner_id?: string | null; accountable_profile_id?: string | null; approval_status?: string | null } | null = null;
  const startDate = payload.startDate || null;
  const endDate = payload.endDate || null;

  if (startDate && endDate && startDate > endDate) {
    return apiError("Das Startdatum darf nicht nach dem Enddatum liegen.", 400);
  }

  if (packageId) {
    const { data: initiativeRow, error: initiativeError } = await supabase
      .from(ACTIVE_PACKAGES_TABLE)
      .select("id,milestone_id,owner_id,accountable_profile_id,approval_status")
      .eq("id", packageId)
      .maybeSingle();
    if (initiativeError || !initiativeRow) {
      return apiError("Initiative wurde nicht gefunden.", 404);
    }
    initiative = initiativeRow;
    milestoneId = milestoneId || initiative.milestone_id || null;
  }


  const taskType: TaskType = requestedType;
  const scoreRelevant = false;
  const status = payload.status && taskStatuses.includes(payload.status as (typeof taskStatuses)[number]) ? payload.status : "Offen";
  const priority = payload.priority && priorities.has(payload.priority) ? payload.priority : "P2";
  const assignee = profileId(payload.assignee || payload.owner) || permission.profile?.id || null;
  const reviewOwnerProfileId = packageId ? initiative?.accountable_profile_id || initiative?.owner_id || null : null;
  const parentTaskId = taskType === "sub_issue" ? payload.parentTaskId || "" : "";

  if (taskType === "deliverable" && !packageId) {
    return apiError("Deliverables brauchen eine Initiative.", 400);
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
      .select("id,title,task_type,package_id,milestone_id,approval_status")
      .eq("id", parentTaskId)
      .single();
    if (parentError || !parent || parent.task_type !== "deliverable") return apiError("Deliverable wurde nicht gefunden.", 404);
    effectivePackageId = parent.package_id || null;
    milestoneId = parent.milestone_id || null;
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
    packageId: effectivePackageId,
    milestoneId,
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
    workstream: cleanText(payload.workstream, 120),
    sortOrder: 0,
    startDate,
    endDate,
    deadline: payload.deadline || null,
    hours: Math.max(0, Math.min(200, Math.round(Number(payload.hours || 0)))),
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
      : payload.approveNow ? "Deliverable erstellt und freigegeben" : "Deliverable vorgeschlagen";
  const requestMetadata = auditRequestMetadata(request);
  const { data: transactionData, error: transactionError } = await supabase.rpc("create_planning_task_transaction", {
    p_task_insert: insert,
    p_relation_type: relatedTaskId ? relationType : null,
    p_related_task_id: relatedTaskId || null,
    p_relation_note: relationNote || null,
    p_activity_message: activityMessage,
    p_relation_activity_message: relatedTaskId && relationType
      ? `Abhängigkeit hinzugefügt: ${relationActionLabel(relationType)}`
      : null,
    p_notifications: notifications,
    p_actor_profile_id: permission.profile?.id || null,
    p_request_ip: requestMetadata.request_ip,
    p_user_agent: requestMetadata.user_agent || null,
    p_approve_now: Boolean(payload.approveNow),
  });
  if (transactionError) {
    if (transactionError.code === "P0002") return apiError("Verknüpfte Aufgabe wurde nicht gefunden.", 404);
    if (transactionError.code === "P0003") {
      return apiError("Erstellungsanfrage wurde mit geänderten Daten wiederholt. Bitte Dialog neu öffnen.", 409);
    }
    if (transactionError.code === "22023") return apiError("Aufgabe oder Abhängigkeit ist ungültig.", 400);
    if (transactionError.code === "23505") return apiError("Aufgabe oder Abhängigkeit existiert bereits.", 409);
    return apiError(transactionError.message || "Aufgabe konnte nicht erstellt werden.", 500);
  }

  const transaction = transactionData as CreateTaskTransactionResult | null;
  const created = transaction?.task;
  if (!created) return apiError("Aufgabe konnte nicht erstellt werden.", 500);

  const profileIds = [...new Set([created.assignee, created.owner, created.created_by].filter((value): value is string => typeof value === "string" && Boolean(value)))];
  const { data: profileRows } = profileIds.length
    ? await supabase.from("profiles").select("id,name").in("id", profileIds)
    : { data: [] };
  const profileNameById = new Map((profileRows || []).map((profile: { id: string; name: string }) => [profile.id, profile.name]));

  const task: Task = mapTaskRow(created as TaskRowForMapping, profileNameById);
  if (task.taskType === "sub_issue") task.parentApprovalStatus = parentApprovalStatus;
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
