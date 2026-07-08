import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { requireFounder } from "@/lib/authz";
import { isOperationalLeadRole } from "@/lib/platform";
import { mapTaskRow, type TaskRowForMapping } from "@/lib/planning-task-mappers";
import { slugify } from "@/lib/slug";
import { taskStatuses } from "@/lib/status";
import { buildTaskInsertRow } from "@/lib/task-insert-row";
import type { Task, TaskType } from "@/lib/types";
import { apiError, requireJsonApiContext } from "@/lib/api-response";

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
};

const taskTypes = new Set(["deliverable", "proposal", "sub_issue"]);
const priorities = new Set(["P0", "P1", "P2", "P3", "P4"]);

function profileId(value?: string) {
  return slugify(value || "");
}

export async function POST(request: NextRequest) {
  const context = await requireJsonApiContext<CreateTaskPayload>(request, requireFounder, {});
  if (!context.ok) return context.response;

  const { payload, permission, supabase } = context;
  const title = cleanText(payload.title, 240);
  if (title.length < 3) return apiError("Titel ist erforderlich.", 400);

  const requestedType = payload.taskType || "deliverable";
  if (!taskTypes.has(requestedType)) return apiError("Ungültiger Aufgabentyp.", 400);

  const isOperationalLead = isOperationalLeadRole(permission.profile?.platformRole);
  const packageId = payload.packageId || null;
  let milestoneId = payload.milestoneId || null;
  let initiative: { id: string; milestone_id: string | null; owner_id?: string | null; accountable_profile_id?: string | null } | null = null;
  const startDate = payload.startDate || null;
  const endDate = payload.endDate || null;

  if (startDate && endDate && startDate > endDate) {
    return apiError("Das Startdatum darf nicht nach dem Enddatum liegen.", 400);
  }

  if (packageId) {
    const { data: initiativeRow, error: initiativeError } = await supabase
      .from("packages")
      .select("id,milestone_id,owner_id,accountable_profile_id")
      .eq("id", packageId)
      .maybeSingle();
    if (initiativeError || !initiativeRow) {
      return apiError("Initiative wurde nicht gefunden.", 404);
    }
    initiative = initiativeRow;
    milestoneId = milestoneId || initiative.milestone_id || null;
  }


  const canCreateDeliverable = isOperationalLead || (requestedType === "deliverable" && initiative?.owner_id === permission.profile?.id);
  const taskType: TaskType = requestedType === "deliverable" && !canCreateDeliverable ? "proposal" : requestedType;
  const scoreRelevant = taskType === "deliverable";
  const status = taskType === "proposal" ? "Vorschlag" : payload.status && taskStatuses.includes(payload.status as (typeof taskStatuses)[number]) ? payload.status : "Offen";
  const priority = payload.priority && priorities.has(payload.priority) ? payload.priority : "P2";
  const assignee = profileId(payload.assignee || payload.owner) || (taskType === "proposal" ? null : permission.profile?.id || null);
  const reviewOwnerProfileId = packageId ? initiative?.accountable_profile_id || initiative?.owner_id || null : null;
  const parentTaskId = taskType === "sub_issue" ? payload.parentTaskId || "" : "";

  if (taskType === "deliverable" && (!packageId || !payload.sprintId)) {
    return apiError("Deliverables brauchen Initiative und Sprint.", 400);
  }

  if (taskType === "sub_issue" && !parentTaskId) {
    return apiError("Sub-Issue braucht ein Deliverable.", 400);
  }

  if (taskType === "sub_issue") {
    const { data: parent, error: parentError } = await supabase
      .from("tasks")
      .select("id,assignee,owner,title")
      .eq("id", parentTaskId)
      .single();
    if (parentError || !parent) return apiError("Deliverable wurde nicht gefunden.", 404);
    if (!isOperationalLead && (parent.assignee || parent.owner) !== permission.profile?.id) {
      return apiError("Founder können nur eigene Deliverables verfeinern.", 403);
    }
  }

  const { data: maxRow } = await supabase
    .from("tasks")
    .select("sort_order")
    .order("sort_order", { ascending: false })
    .limit(1)
    .maybeSingle();

  const idBase = `${permission.profile?.id || "task"}-${slugify(title, { maxLength: 70 }) || "neue-aufgabe"}`;
  const id = `${idBase}-${Date.now().toString(36)}`;
  const sortOrder = Number(maxRow?.sort_order || 0) + 1;

  const insert = buildTaskInsertRow({
    id,
    packageId,
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
    sortOrder,
    startDate,
    endDate,
    deadline: payload.deadline || null,
    hours: Math.max(0, Math.min(200, Math.round(Number(payload.hours || 0)))),
    definitionOfDone: cleanText(payload.definitionOfDone, 4000),
    sprintId: taskType === "proposal" || taskType === "sub_issue" ? null : payload.sprintId || null,
    reviewOwnerProfileId,
    taskType,
    parentTaskId,
    scoreRelevant,
  });

  const { data: created, error: insertError } = await supabase.from("tasks").insert(insert).select("*").single();
  if (insertError || !created) return apiError(insertError?.message || "Aufgabe konnte nicht erstellt werden.", 500);

  const profileIds = [...new Set([created.assignee, created.owner, created.created_by].filter((value): value is string => typeof value === "string" && Boolean(value)))];
  const { data: profileRows } = profileIds.length
    ? await supabase.from("profiles").select("id,name").in("id", profileIds)
    : { data: [] };
  const profileNameById = new Map((profileRows || []).map((profile: { id: string; name: string }) => [profile.id, profile.name]));

  await supabase.from("task_activity").insert({
    task_id: id,
    message: taskType === "proposal" ? "Aufgabenvorschlag erstellt" : taskType === "sub_issue" ? "Sub-Issue erstellt" : "Deliverable erstellt",
  });

  if (taskType === "proposal") {
    const { data: leads } = await supabase.from("profiles").select("id").in("platform_role", ["ceo", "deputy"]);
    const notifications = (leads || [])
      .filter((lead) => lead.id !== permission.profile?.id)
      .map((lead) => ({
        type: "task.proposed",
        actor_profile_id: permission.profile?.id || null,
        recipient_profile_id: lead.id,
        entity_type: "task",
        entity_id: id,
        title: `Aufgabenvorschlag: ${title}`,
        body: insert.description || "Founder hat eine neue Aufgabe vorgeschlagen.",
      }));
    if (notifications.length) await supabase.from("notification_events").insert(notifications);
  }

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile?.id || null,
    action: "task.create",
    entity_type: "task",
    entity_id: id,
    after_data: { ...insert },
    ...auditRequestMetadata(request),
  });

  const task: Task = mapTaskRow(created as TaskRowForMapping, profileNameById);

  return NextResponse.json({ ok: true, task });
}
