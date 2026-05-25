import { NextResponse, type NextRequest } from "next/server";
import { requireFounder } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";

type CommentPayload = {
  comment?: string;
};

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireFounder(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  const { id } = await context.params;
  const payload = (await request.json()) as CommentPayload;
  const comment = typeof payload.comment === "string" ? payload.comment.trim().slice(0, 4000) : "";

  if (comment.length < 2) {
    return NextResponse.json({ error: "Kommentar ist erforderlich." }, { status: 400 });
  }

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id,title,owner")
    .eq("id", id)
    .single();

  if (taskError || !task) return NextResponse.json({ error: "Aufgabe wurde nicht gefunden." }, { status: 404 });

  const { data: created, error: insertError } = await supabase
    .from("task_comments")
    .insert({
      task_id: id,
      profile_id: permission.profile?.id || null,
      comment,
    })
    .select("id,task_id,profile_id,comment,created_at")
    .single();

  if (insertError || !created) return NextResponse.json({ error: insertError?.message || "Kommentar konnte nicht gespeichert werden." }, { status: 500 });

  const recipients = new Set<string>();
  if (task.owner && task.owner !== permission.profile?.id) recipients.add(task.owner);

  const { data: leads } = await supabase.from("profiles").select("id").in("platform_role", ["ceo", "deputy"]);
  leads?.forEach((lead) => {
    if (lead.id !== permission.profile?.id) recipients.add(lead.id);
  });

  if (recipients.size) {
    await supabase.from("notification_events").insert(
      [...recipients].map((recipientId) => ({
        type: "task.comment",
        actor_profile_id: permission.profile?.id || null,
        recipient_profile_id: recipientId,
        entity_type: "task",
        entity_id: id,
        title: `Neuer Kommentar: ${task.title}`,
        body: comment,
      })),
    );
  }

  await supabase.from("task_activity").insert({
    task_id: id,
    message: `Kommentar hinzugefuegt: ${comment.slice(0, 160)}`,
  });

  return NextResponse.json({
    ok: true,
    comment: {
      id: created.id,
      taskId: created.task_id,
      profileId: created.profile_id || "",
      comment: created.comment,
      createdAt: created.created_at,
    },
  });
}
