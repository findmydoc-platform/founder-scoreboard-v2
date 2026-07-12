import { NextResponse, type NextRequest } from "next/server";
import { cleanText } from "@/lib/api-input";
import { requirePlanningContributor } from "@/lib/authz";
import { deliverPendingGitHubComments } from "@/lib/github-comment-delivery";
import { mentionedProfileIds } from "@/lib/mentions";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { createNotificationPayload } from "@/lib/notification-catalog";

type CommentPayload = {
  comment?: string;
};

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<CommentPayload>(request, requirePlanningContributor, {});
  if (!apiContext.ok) return apiContext.response;

  const { payload, permission, supabase } = apiContext;
  const { id } = await context.params;
  const comment = cleanText(payload.comment, 4000);

  if (comment.length < 2) {
    return apiError("Kommentar ist erforderlich.", 400);
  }

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id,title,assignee,owner,github_issue_number,github_issue_url,issue_number,issue_url")
    .eq("id", id)
    .single();

  if (taskError || !task) return apiError("Aufgabe wurde nicht gefunden.", 404);

  const { data: transaction, error: insertError } = await supabase.rpc("create_task_comment_with_github_delivery", {
    p_task_id: id,
    p_profile_id: permission.profile?.id || "",
    p_comment: comment,
  });
  const created = transaction?.comment as {
    id: number;
    task_id: string;
    profile_id: string | null;
    comment: string;
    created_at: string;
  } | undefined;

  if (insertError || !created) return apiError(insertError?.message || "Kommentar konnte nicht gespeichert werden.", 500);

  await deliverPendingGitHubComments({ supabase, taskId: id, limit: 20 }).catch(() => undefined);
  const { data: delivery } = await supabase
    .from("task_comment_github_deliveries")
    .select("status,github_comment_url")
    .eq("task_comment_id", created.id)
    .maybeSingle<{ status: string; github_comment_url: string | null }>();
  const deliveryStatus = delivery?.status || transaction?.deliveryStatus || "pending";

  const { data: profiles } = await supabase.from("profiles").select("id,name,github_login,platform_role");
  const mentionedRecipients = new Set(mentionedProfileIds(
    comment,
    (profiles || []).map((profile) => ({
      id: profile.id,
      name: profile.name,
      githubLogin: profile.github_login,
    })),
    permission.profile?.id || "",
  ));

  const recipients = new Set<string>();
  const assignee = task.assignee || task.owner;
  if (assignee && assignee !== permission.profile?.id && !mentionedRecipients.has(assignee)) recipients.add(assignee);

  const leads = (profiles || []).filter((profile) => ["ceo", "deputy"].includes(profile.platform_role));
  leads?.forEach((lead) => {
    if (lead.id !== permission.profile?.id && !mentionedRecipients.has(lead.id)) recipients.add(lead.id);
  });

  const notificationEvents = [
    ...[...mentionedRecipients].map((recipientId) => createNotificationPayload("task.mention", {
      actorProfileId: permission.profile?.id,
      recipientProfileId: recipientId,
      entityType: "task",
      entityId: id,
      title: `Du wurdest erwähnt: ${task.title}`,
      body: comment,
    })),
    ...[...recipients].map((recipientId) => createNotificationPayload("task.comment", {
      actorProfileId: permission.profile?.id,
      recipientProfileId: recipientId,
      entityType: "task",
      entityId: id,
      title: `Neuer Kommentar: ${task.title}`,
      body: comment,
    })),
  ];

  if (notificationEvents.length) {
    await supabase.from("notification_events").insert(
      notificationEvents,
    );
  }

  return NextResponse.json({
    ok: true,
    comment: {
      id: created.id,
      taskId: created.task_id,
      profileId: created.profile_id || "",
      comment: created.comment,
      githubDeliveryStatus: deliveryStatus,
      githubCommentUrl: delivery?.github_comment_url || "",
      createdAt: created.created_at,
    },
    notice: deliveryStatus === "waiting_for_author_connection" ? {
      code: "github_author_connection_required",
      level: "info",
      message: "Kommentar gespeichert. Veröffentlichung wartet auf deine GitHub-Verbindung.",
    } : null,
  });
}
