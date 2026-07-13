import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { requirePlanningContributor } from "@/lib/authz";
import { taskRelationshipAccess } from "@/features/tasks/model/task-relationship-permissions";
import type { AuthenticatedProfile, Task, TaskRelation, TaskRelationType } from "@/lib/types";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { ACTIVE_PACKAGES_TABLE, ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";
import { requireActivePlanningItem } from "@/lib/planning-trash-mutation-guard";

type RelationPayload = {
  relationType?: TaskRelationType;
  relatedTaskId?: string;
  note?: string;
  relationId?: number;
};

const relationTypes = new Set<TaskRelationType>(["blocked_by", "blocks", "relates_to"]);

function relationActionLabel(type: TaskRelationType) {
  if (type === "blocked_by") return "Wartet auf";
  if (type === "blocks") return "Blockiert";
  return "Verknüpft mit";
}

type RelationshipTaskRow = {
  id: string;
  title: string;
  task_type: Task["taskType"];
  assignee: string | null;
  owner: string | null;
  package_id: string | null;
};

type RelationshipInitiativeRow = {
  owner_id: string | null;
  accountable_profile_id: string | null;
};

async function loadRelationshipAccess(
  supabase: SupabaseClient,
  taskId: string,
  profile: AuthenticatedProfile | null,
) {
  const { data: task, error: taskError } = await supabase
    .from(ACTIVE_TASKS_TABLE)
    .select("id,title,task_type,assignee,owner,package_id")
    .eq("id", taskId)
    .single<RelationshipTaskRow>();
  if (taskError || !task) return { ok: false as const, response: apiError("Aufgabe wurde nicht gefunden.", 404) };

  let initiative: RelationshipInitiativeRow | null = null;
  if (task.package_id) {
    const initiativeResult = await supabase
      .from(ACTIVE_PACKAGES_TABLE)
      .select("owner_id,accountable_profile_id")
      .eq("id", task.package_id)
      .maybeSingle<RelationshipInitiativeRow>();
    if (initiativeResult.error) return { ok: false as const, response: apiError(initiativeResult.error.message, 500) };
    initiative = initiativeResult.data;
  }

  const access = taskRelationshipAccess({
    task: {
      id: task.id,
      taskType: task.task_type,
      assignee: task.assignee || "",
      owner: task.owner || "",
    },
    initiative: initiative ? {
      ownerId: initiative.owner_id || "",
      accountableProfileId: initiative.accountable_profile_id || "",
    } : undefined,
    profile,
    unrestricted: !profile,
  });

  return { ok: true as const, access, task };
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<RelationPayload>(request, requirePlanningContributor, {});
  if (!apiContext.ok) return apiContext.response;

  const { payload, permission, supabase } = apiContext;
  const { id } = await context.params;
  const activeItem = await requireActivePlanningItem(supabase, "tasks", id);
  if (!activeItem.ok) return apiError(activeItem.error, activeItem.status);
  const relationType = payload.relationType;
  const relatedTaskId = typeof payload.relatedTaskId === "string" ? payload.relatedTaskId.trim() : "";
  const note = cleanText(payload.note, 500);

  if (!relationType || !relationTypes.has(relationType)) {
    return apiError("Ungültige Abhängigkeitsart.", 400);
  }
  if (!relatedTaskId || relatedTaskId === id) {
    return apiError("Bitte eine andere Aufgabe auswählen.", 400);
  }
  const activeRelatedItem = await requireActivePlanningItem(supabase, "tasks", relatedTaskId);
  if (!activeRelatedItem.ok) return apiError(activeRelatedItem.error, activeRelatedItem.status);

  const accessResult = await loadRelationshipAccess(supabase, id, permission.profile);
  if (!accessResult.ok) return accessResult.response;
  if (!accessResult.access.allowedRelationTypes.includes(relationType)) {
    return apiError("Nur Owner, Accountable, CEO oder Deputy können diese Blocker-Abhängigkeit verwalten.", 403);
  }

  const { data: tasks, error: taskError } = await supabase
    .from(ACTIVE_TASKS_TABLE)
    .select("id,title")
    .in("id", [id, relatedTaskId]);
  if (taskError) return apiError(taskError.message, 500);
  if ((tasks || []).length !== 2) return apiError("Eine der Aufgaben wurde nicht gefunden.", 404);

  const { data: relation, error } = await supabase
    .from("task_relationship_edges")
    .insert({
      task_id: id,
      related_task_id: relatedTaskId,
      relation_type: relationType,
      note,
      created_by: permission.profile?.id || null,
    })
    .select("id,task_id,related_task_id,relation_type,note,created_by,created_at")
    .single();

  if (error || !relation) {
    const duplicate = error?.code === "23505";
    return apiError(duplicate ? "Diese Abhängigkeit existiert bereits." : error?.message || "Abhängigkeit konnte nicht gespeichert werden.", duplicate ? 409 : 500);
  }

  await supabase.from("task_activity").insert({
    task_id: id,
    message: `Abhängigkeit hinzugefügt: ${relationActionLabel(relationType)}`,
  });

  await supabase.from("tasks").update({
    github_issue_sync_status: "not_synced",
    github_issue_sync_error: null,
  }).in("id", [id, relatedTaskId]);

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile?.id || null,
    action: "task.relationship_created",
    entity_type: "task",
    entity_id: id,
    after_data: { relationType, relatedTaskId, note },
    ...auditRequestMetadata(request),
  });

  return NextResponse.json({
    ok: true,
    relation: {
      id: relation.id,
      taskId: relation.task_id,
      relatedTaskId: relation.related_task_id,
      relationType: relation.relation_type,
      note: relation.note || "",
      createdBy: relation.created_by || "",
      createdAt: relation.created_at,
    },
  });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<RelationPayload>(request, requirePlanningContributor, {});
  if (!apiContext.ok) return apiContext.response;

  const { payload, permission, supabase } = apiContext;
  const { id } = await context.params;
  const activeItem = await requireActivePlanningItem(supabase, "tasks", id);
  if (!activeItem.ok) return apiError(activeItem.error, activeItem.status);
  const relationId = Number(payload.relationId);
  if (!Number.isInteger(relationId) || relationId <= 0) {
    return apiError("Abhängigkeit ist erforderlich.", 400);
  }

  const { data: relation, error: readError } = await supabase
    .from("task_relationship_edges")
    .select("id,task_id,related_task_id,relation_type,note")
    .eq("id", relationId)
    .single();
  if (readError || !relation) return apiError("Abhängigkeit wurde nicht gefunden.", 404);
  if (relation.task_id !== id && relation.related_task_id !== id) {
    return apiError("Abhängigkeit gehört nicht zu dieser Aufgabe.", 403);
  }
  const otherTaskId = relation.task_id === id ? relation.related_task_id : relation.task_id;
  const activeRelatedItem = await requireActivePlanningItem(supabase, "tasks", otherTaskId);
  if (!activeRelatedItem.ok) return apiError(activeRelatedItem.error, activeRelatedItem.status);

  const accessResult = await loadRelationshipAccess(supabase, id, permission.profile);
  if (!accessResult.ok) return accessResult.response;
  const mappedRelation: TaskRelation = {
    id: relation.id,
    taskId: relation.task_id,
    relatedTaskId: relation.related_task_id,
    relationType: relation.relation_type,
    note: relation.note || "",
    createdBy: "",
    createdAt: "",
  };
  if (!accessResult.access.canRemoveRelation(mappedRelation)) {
    return apiError("Nur Owner, Accountable, CEO oder Deputy können diese Blocker-Abhängigkeit verwalten.", 403);
  }

  const { error } = await supabase.from("task_relationship_edges").delete().eq("id", relationId);
  if (error) return apiError(error.message, 500);

  await supabase.from("task_activity").insert({
    task_id: id,
    message: `Abhängigkeit entfernt: ${relationActionLabel(relation.relation_type)}`,
  });

  await supabase.from("tasks").update({
    github_issue_sync_status: "not_synced",
    github_issue_sync_error: null,
  }).in("id", [relation.task_id, relation.related_task_id]);

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile?.id || null,
    action: "task.relationship_deleted",
    entity_type: "task",
    entity_id: id,
    before_data: relation,
    ...auditRequestMetadata(request),
  });

  return NextResponse.json({ ok: true, relationId });
}
