import { NextResponse, type NextRequest } from "next/server";
import { requireFounder } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";

type BlockerPayload = {
  reason?: string;
  impact?: string;
  needsHelpFrom?: string;
};

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireFounder(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  const { id } = await context.params;
  const payload = (await request.json()) as BlockerPayload;
  const reason = typeof payload.reason === "string" ? payload.reason.trim().slice(0, 2000) : "";
  const impact = typeof payload.impact === "string" ? payload.impact.trim().slice(0, 2000) : "";
  const needsHelpFrom = typeof payload.needsHelpFrom === "string" ? payload.needsHelpFrom.trim().slice(0, 500) : "";

  if (reason.length < 5) {
    return NextResponse.json({ error: "Blocker-Grund ist erforderlich." }, { status: 400 });
  }

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id,title,owner,status")
    .eq("id", id)
    .single();

  if (taskError || !task) return NextResponse.json({ error: "Aufgabe wurde nicht gefunden." }, { status: 404 });

  const { data: blocker, error: insertError } = await supabase
    .from("task_blockers")
    .insert({
      task_id: id,
      profile_id: permission.profile?.id || null,
      reason,
      impact,
      needs_help_from: needsHelpFrom,
      status: "open",
    })
    .select("id,task_id,profile_id,reason,impact,needs_help_from,status,created_at,resolved_at")
    .single();

  if (insertError || !blocker) return NextResponse.json({ error: insertError?.message || "Blocker konnte nicht gespeichert werden." }, { status: 500 });

  await supabase.from("tasks").update({ status: "Blockiert" }).eq("id", id);

  const { data: leads } = await supabase.from("profiles").select("id").in("platform_role", ["ceo", "deputy"]);
  const notifications = (leads || [])
    .filter((lead) => lead.id !== permission.profile?.id)
    .map((lead) => ({
      type: "task.blocker_reported",
      actor_profile_id: permission.profile?.id || null,
      recipient_profile_id: lead.id,
      entity_type: "task",
      entity_id: id,
      title: `Blocker gemeldet: ${task.title}`,
      body: [reason, impact ? `Impact: ${impact}` : "", needsHelpFrom ? `Braucht Hilfe von: ${needsHelpFrom}` : ""].filter(Boolean).join("\n"),
    }));
  if (notifications.length) {
    await supabase.from("notification_events").insert(notifications);
  }

  await supabase.from("task_activity").insert({
    task_id: id,
    message: `Blocker gemeldet: ${reason.slice(0, 160)}`,
  });

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile?.id || null,
    action: "task.blocker_reported",
    entity_type: "task",
    entity_id: id,
    after_data: { reason, impact, needsHelpFrom, status: "Blockiert" },
    request_ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    user_agent: request.headers.get("user-agent"),
  });

  return NextResponse.json({
    ok: true,
    blocker: {
      id: blocker.id,
      taskId: blocker.task_id,
      profileId: blocker.profile_id || "",
      reason: blocker.reason,
      impact: blocker.impact || "",
      needsHelpFrom: blocker.needs_help_from || "",
      status: blocker.status,
      createdAt: blocker.created_at,
      resolvedAt: blocker.resolved_at || "",
    },
    task: { id, status: "Blockiert" },
  });
}
