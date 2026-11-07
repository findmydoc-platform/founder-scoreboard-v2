import { observeRuntimeHandler, observeRuntimePreparation } from "@/lib/runtime-logging";
import { after, NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { cleanText } from "@/lib/api-input";
import { requirePlanningContext, requirePlanningJsonContext } from "@/features/planning/server/planning-api-context";
import { mentionedProfileIds } from "@/lib/mentions";
import { apiError } from "@/lib/api-response";
import { mapTaskComment } from "@/lib/planning-activity-mappers";
import type { DbTaskComment } from "@/lib/planning-row-types";

type CommentPayload = {
  comment?: string;
  submissionId?: string;
  submittedAt?: string;
};
const validSubmissionId = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

async function handleGET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const apiContext = await requirePlanningContext(request, "planning.comment.create", id);
  if (!apiContext.ok) return apiContext.response;
  const active = await apiContext.planning.ensureCollaborationActive();
  if (!active.ok) return apiError(active.error, active.status);
  const submissionId = request.nextUrl.searchParams.get("submissionId");
  if (!validSubmissionId(submissionId)) return apiError("Kommentarbestätigung ist ungültig.", 400);
  const { data, error } = await apiContext.planning.readCommentSubmission(submissionId);
  if (error) return apiError("Kommentarbestätigung konnte nicht geprüft werden.", error.code === "42501" ? 403 : 500);
  if (!data) return NextResponse.json({ ok: true, outcome: "unconfirmed" });
  const row = (Array.isArray(data.task_comments) ? data.task_comments[0] : data.task_comments) as DbTaskComment | undefined;
  if (!row) return apiError("Kommentarbestätigung konnte nicht geprüft werden.", 500);
  return NextResponse.json({ ok: true, outcome: "confirmed", comment: {
    ...mapTaskComment(row), submissionId: data.id, submittedAt: new Date(data.submitted_at).toISOString(),
  } });
}

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
  const legacy = payload.submissionId === undefined && payload.submittedAt === undefined;
  if (!legacy && typeof payload.comment === "string" && payload.comment.trim().length > 4000) {
    return apiError("Kommentar darf höchstens 4000 Zeichen enthalten.", 400);
  }
  const submissionId = legacy ? randomUUID() : payload.submissionId;
  const submittedAt = legacy ? new Date().toISOString() : payload.submittedAt;
  if (!validSubmissionId(submissionId) || typeof submittedAt !== "string" || !Number.isFinite(Date.parse(submittedAt))) {
    return apiError("Kommentarbestätigung ist ungültig.", 400);
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
  const { data: transaction, error: insertError } = await planning.writeComment({ comment, submissionId, submittedAt: new Date(submittedAt).toISOString(), mentions: [...mentionedRecipients], recipients: [...commentRecipients] });
  const created = transaction?.comment as {
    id: number;
    task_id: string;
    profile_id: string | null;
    comment: string;
    created_at: string;
  } | undefined;

  if (insertError?.code === "P0014") return apiError("Die Kommentarbestätigung gehört zu einer anderen Übermittlung.", 409);
  if (insertError || !created) return apiError(insertError?.message || "Kommentar konnte nicht gespeichert werden.", 500);

  if (!isStrategic) {
    after(async () => { await planning.deliverComments().catch(() => undefined); });
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
      submissionId,
      submittedAt: new Date(transaction.submittedAt).toISOString(),
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
export const GET = observeRuntimeHandler("task.comment", handleGET);
