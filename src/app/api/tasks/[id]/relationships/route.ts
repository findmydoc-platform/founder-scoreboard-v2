import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { requireOperationalLead } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";
import type { TaskRelationType } from "@/lib/types";

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

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireOperationalLead(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  const { id } = await context.params;
  const payload = (await request.json()) as RelationPayload;
  const relationType = payload.relationType;
  const relatedTaskId = typeof payload.relatedTaskId === "string" ? payload.relatedTaskId.trim() : "";
  const note = cleanText(payload.note, 500);

  if (!relationType || !relationTypes.has(relationType)) {
    return NextResponse.json({ error: "Ungültige Relationship-Art." }, { status: 400 });
  }
  if (!relatedTaskId || relatedTaskId === id) {
    return NextResponse.json({ error: "Bitte eine andere Aufgabe auswählen." }, { status: 400 });
  }

  const { data: tasks, error: taskError } = await supabase
    .from("tasks")
    .select("id,title")
    .in("id", [id, relatedTaskId]);
  if (taskError) return NextResponse.json({ error: taskError.message }, { status: 500 });
  if ((tasks || []).length !== 2) return NextResponse.json({ error: "Eine der Aufgaben wurde nicht gefunden." }, { status: 404 });

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
    return NextResponse.json({ error: duplicate ? "Diese Relationship existiert bereits." : error?.message || "Relationship konnte nicht gespeichert werden." }, { status: duplicate ? 409 : 500 });
  }

  await supabase.from("task_activity").insert({
    task_id: id,
    message: `Relationship hinzugefügt: ${relationActionLabel(relationType)}`,
  });

  await supabase.from("tasks").update({
    github_sync_status: "not_synced",
    github_sync_error: null,
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
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireOperationalLead(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  const { id } = await context.params;
  const payload = (await request.json()) as RelationPayload;
  const relationId = Number(payload.relationId);
  if (!Number.isInteger(relationId) || relationId <= 0) {
    return NextResponse.json({ error: "Relationship-ID ist erforderlich." }, { status: 400 });
  }

  const { data: relation, error: readError } = await supabase
    .from("task_relationship_edges")
    .select("id,task_id,related_task_id,relation_type,note")
    .eq("id", relationId)
    .single();
  if (readError || !relation) return NextResponse.json({ error: "Relationship wurde nicht gefunden." }, { status: 404 });
  if (relation.task_id !== id && relation.related_task_id !== id) {
    return NextResponse.json({ error: "Relationship gehört nicht zu dieser Aufgabe." }, { status: 403 });
  }

  const { error } = await supabase.from("task_relationship_edges").delete().eq("id", relationId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("task_activity").insert({
    task_id: id,
    message: `Relationship entfernt: ${relationActionLabel(relation.relation_type)}`,
  });

  await supabase.from("tasks").update({
    github_sync_status: "not_synced",
    github_sync_error: null,
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
