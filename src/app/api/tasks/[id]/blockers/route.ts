import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { requireFounder } from "@/lib/authz";
import { apiError, requireJsonApiContext } from "@/lib/api-response";

type BlockerPayload = {
  reason?: string;
  impact?: string;
  needsHelpFrom?: string;
};

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<BlockerPayload>(request, requireFounder, {});
  if (!apiContext.ok) return apiContext.response;

  const { payload, permission, supabase } = apiContext;
  const { id } = await context.params;
  const reason = cleanText(payload.reason, 2000);
  const impact = cleanText(payload.impact, 2000);
  const needsHelpFrom = cleanText(payload.needsHelpFrom, 500);

  if (reason.length < 5) {
    return apiError("Blocker-Grund ist erforderlich.", 400);
  }

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id,title,owner,status")
    .eq("id", id)
    .single();

  if (taskError || !task) return apiError("Aufgabe wurde nicht gefunden.", 404);

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

  if (insertError || !blocker) return apiError(insertError?.message || "Blocker konnte nicht gespeichert werden.", 500);

  await supabase.from("tasks").update({
    status: "Blockiert",
    github_sync_status: "not_synced",
    github_sync_error: null,
  }).eq("id", id);

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
    ...auditRequestMetadata(request),
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
