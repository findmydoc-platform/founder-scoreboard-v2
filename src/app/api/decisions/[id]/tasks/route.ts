import { NextResponse, type NextRequest } from "next/server";
import { requireFounder } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";
import type { DecisionTaskLink } from "@/lib/types";

type LinkPayload = {
  taskId?: string;
  linkType?: DecisionTaskLink["linkType"];
  note?: string;
};

const linkTypes = new Set(["follows_from", "supports", "blocks_decision"]);

function mapDecisionTaskLink(row: Record<string, string | number>): DecisionTaskLink {
  return {
    id: Number(row.id),
    decisionId: Number(row.decision_id),
    taskId: String(row.task_id || ""),
    linkType: String(row.link_type || "follows_from") as DecisionTaskLink["linkType"],
    note: String(row.note || ""),
    createdBy: String(row.created_by || ""),
    createdAt: String(row.created_at || ""),
  };
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireFounder(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  const { id } = await context.params;
  const decisionId = Number(id);
  if (!Number.isFinite(decisionId)) return NextResponse.json({ error: "Decision ist ungültig." }, { status: 400 });

  const payload = (await request.json()) as LinkPayload;
  const taskId = typeof payload.taskId === "string" ? payload.taskId.trim() : "";
  if (!taskId) return NextResponse.json({ error: "Aufgabe ist erforderlich." }, { status: 400 });

  const { data: decision, error: decisionError } = await supabase.from("decision_log").select("id,title").eq("id", decisionId).single();
  if (decisionError || !decision) return NextResponse.json({ error: "Decision nicht gefunden." }, { status: 404 });

  const { data: task, error: taskError } = await supabase.from("tasks").select("id,title").eq("id", taskId).single();
  if (taskError || !task) return NextResponse.json({ error: "Aufgabe nicht gefunden." }, { status: 404 });

  const linkType = payload.linkType && linkTypes.has(payload.linkType) ? payload.linkType : "follows_from";
  const { data, error } = await supabase
    .from("decision_task_links")
    .upsert({
      decision_id: decisionId,
      task_id: taskId,
      link_type: linkType,
      note: typeof payload.note === "string" ? payload.note.trim().slice(0, 1000) : "",
      created_by: permission.profile?.id || null,
    }, { onConflict: "decision_id,task_id" })
    .select("id,decision_id,task_id,link_type,note,created_by,created_at")
    .single();

  if (error || !data) return NextResponse.json({ error: error?.message || "Verknüpfung konnte nicht gespeichert werden." }, { status: 500 });

  await supabase.from("task_activity").insert({
    task_id: taskId,
    message: `Mit Decision verknüpft: ${decision.title}`,
  });

  return NextResponse.json({ ok: true, link: mapDecisionTaskLink(data) });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireFounder(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  const { id } = await context.params;
  const decisionId = Number(id);
  const linkId = Number(request.nextUrl.searchParams.get("linkId"));
  if (!Number.isFinite(decisionId) || !Number.isFinite(linkId)) {
    return NextResponse.json({ error: "Decision-Link ist ungültig." }, { status: 400 });
  }

  const { data: link, error: readError } = await supabase
    .from("decision_task_links")
    .select("id,task_id")
    .eq("id", linkId)
    .eq("decision_id", decisionId)
    .single();
  if (readError || !link) return NextResponse.json({ error: "Decision-Link nicht gefunden." }, { status: 404 });

  const { error } = await supabase.from("decision_task_links").delete().eq("id", linkId).eq("decision_id", decisionId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase.from("task_activity").insert({
    task_id: link.task_id,
    message: "Decision-Verknüpfung entfernt",
  });

  return NextResponse.json({ ok: true });
}
