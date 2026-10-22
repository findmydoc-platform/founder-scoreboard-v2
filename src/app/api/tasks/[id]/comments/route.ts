import { observeRuntimeHandler, observeRuntimePreparation } from "@/lib/runtime-logging";
import { NextResponse, type NextRequest } from "next/server";
import { cleanText } from "@/lib/api-input";
import { requirePlanningJsonContext } from "@/features/planning/server/planning-api-context";
import { mentionedProfileIds } from "@/lib/mentions";
import { apiError } from "@/lib/api-response";

type CommentPayload = {
  comment?: string;
};

async function handlePOST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const apiContext = await requirePlanningJsonContext<CommentPayload>(request, "planning.comment.create", {}, id);
  if (!apiContext.ok) return apiContext.response;

  const { payload, permission, planning } = apiContext;
  const activeItem = await planning.ensureCollaborationActive();
  if (!activeItem.ok) return apiError(activeItem.error, activeItem.status);
  const comment = cleanText(payload.comment, 4000);

  if (comment.length < 2) {
    return apiError("Kommentar ist erforderlich.", 400);
  }

  const { data: task, error: taskError } = await planning.readCollaborationTask();

  if (taskError || !task) return apiError("Aufgabe wurde nicht gefunden.", 404);

  const { data: profiles, error: profilesError } = await planning.readCollaborationProfiles();
  if (profilesError) return apiError(profilesError.message, 500);

  const actorProfileId = permission.profile?.id || "";
  const mentionedRecipients = new Set(mentionedProfileIds(
    comment,
    (profiles || []).map((profile) => ({
      id: profile.id,
      name: profile.name,
      githubLogin: profile.github_login,
    })),
  ));
  const commentRecipients = new Set<string>();
  const assignee = task.assignee || task.owner;
  if (assignee && assignee !== actorProfileId && !mentionedRecipients.has(assignee)) commentRecipients.add(assignee);
  (profiles || [])
    .filter((profile) => ["ceo", "deputy"].includes(profile.platform_role))
    .forEach((lead) => {
      if (lead.id !== actorProfileId && !mentionedRecipients.has(lead.id)) commentRecipients.add(lead.id);
    });

  const isStrategic = task.task_type === "epic" || task.task_type === "initiative";
  const { data: transaction, error: insertError } = await planning.writeComment({ comment, mentions: [...mentionedRecipients], recipients: [...commentRecipients] });
  const created = transaction?.comment as {
    id: number;
    task_id: string;
    profile_id: string | null;
    comment: string;
    created_at: string;
  } | undefined;

  if (insertError || !created) return apiError(insertError?.message || "Kommentar konnte nicht gespeichert werden.", 500);

  if (!isStrategic) {
    await planning.deliverComments().catch(() => undefined);
  }
  const delivery = isStrategic
    ? null
    : await planning.readCommentDelivery(created.id);
  const deliveryStatus = isStrategic
    ? "not_applicable"
    : delivery?.data?.status || transaction?.deliveryStatus || "pending";

  return observeRuntimePreparation(() => NextResponse.json({
    ok: true,
    comment: {
      id: created.id,
      taskId: created.task_id,
      profileId: created.profile_id || "",
      comment: created.comment,
      githubDeliveryStatus: deliveryStatus,
      githubCommentUrl: delivery?.data?.github_comment_url || "",
      createdAt: created.created_at,
    },
    notice: !isStrategic && deliveryStatus === "waiting_for_author_connection" ? {
      code: "github_author_connection_required",
      level: "info",
      message: "Kommentar gespeichert. Veröffentlichung wartet auf deine GitHub-Verbindung.",
    } : null,
  }));
}

export const POST = observeRuntimeHandler("task.comment", handlePOST);
