import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requirePlanningContext } from "@/features/planning/server/planning-api-context";
import { resolveGitHubIssueNumber } from "@/lib/github-issue-reference";
import { compactAlphanumeric, slugify } from "@/lib/slug";
import { apiError } from "@/lib/api-response";
import { auditRequestMetadata } from "@/lib/api-input";
import { taskDetailPermissions } from "@/features/tasks/model/task-detail-permissions";
import { reviewStateLockMessage, TASK_COMPLETED_LOCKED_MESSAGE } from "@/features/reviews/model/task-review-state";

const maxUploadBytes = 10 * 1024 * 1024;
const allowedMimeTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/pdf",
  "text/plain",
  "text/markdown",
]);

function safeFileName(value: string) {
  const fallback = "anhang";
  const trimmed = value.trim() || fallback;
  const parts = trimmed.split(".");
  const extension = parts.length > 1 ? parts.pop() || "" : "";
  const base = slugify(parts.join(".") || trimmed, { maxLength: 80 }) || fallback;
  return extension ? `${base}.${compactAlphanumeric(extension)}` : base;
}

function isImageType(type: string) {
  return type.toLowerCase().startsWith("image/");
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const apiContext = await requirePlanningContext(request, "planning.attachment.write", id);
  if (!apiContext.ok) return apiContext.response;

  const { permission, planning } = apiContext;

  const activeItem = await planning.ensureCollaborationActive();
  if (!activeItem.ok) return apiError(activeItem.error, activeItem.status);
  const { data: task, error: taskError } = await planning.readCollaborationTask();

  if (taskError || !task) return apiError("Aufgabe wurde nicht gefunden.", 404);
  if (task.task_type === "epic" || task.task_type === "initiative") {
    return apiError("Strategische Planungselemente unterstützen keine GitHub-Anhänge.", 400);
  }
  const detailPermissions = taskDetailPermissions({
    task: {
      assignee: task.assignee || "",
      assigneeId: task.assignee || "",
      owner: task.owner || "",
      ownerId: task.owner || "",
      reviewOwnerProfileId: task.review_owner_profile_id || "",
      reviewStatus: task.review_status || "not_requested",
      scoreFinal: Boolean(task.score_final),
      status: task.status || "",
      taskType: task.task_type,
    },
    profile: permission.profile,
    unrestricted: !permission.profile,
  });
  const canAttach = task.task_type === "deliverable"
    ? detailPermissions.canEditEvidence
    : detailPermissions.canEditBrief;
  if (!canAttach) {
    if (task.status === "Erledigt") return apiError(TASK_COMPLETED_LOCKED_MESSAGE, 409);
    if (task.review_status === "requested" || task.score_final) {
      return apiError(reviewStateLockMessage(task.review_status, Boolean(task.score_final)), 409);
    }
    return apiError("Du darfst für dieses Issue keine Anhänge hochladen.", 403);
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return apiError("Datei ist erforderlich.", 400);
  if (file.size <= 0) return apiError("Datei ist leer.", 400);
  if (file.size > maxUploadBytes) return apiError("Datei ist zu groß. Maximal erlaubt sind 10 MB.", 413);
  if (!allowedMimeTypes.has(file.type)) return apiError("Dateityp wird noch nicht unterstützt.", 415);

  const buffer = Buffer.from(await file.arrayBuffer());
  const suppliedOperation = request.headers.get("idempotency-key")?.trim() || "";
  if (suppliedOperation && !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(suppliedOperation)) return apiError("Upload-Operations-ID ist ungültig.", 400);
  // Existing callers without an operation retain deterministic content reconciliation.
  const identity = createHash("sha256").update(`${permission.profile?.id || ""}\0${suppliedOperation}\0${file.name}\0${file.type}\0`).update(suppliedOperation ? "" : buffer).digest("hex");
  const path = `.fmd-attachments/tasks/${id}/${identity}-${safeFileName(file.name)}`;
  const upload = await planning.uploadAttachment({ path, bytes: buffer, filename: file.name, contentType: file.type });
  if (!upload.ok) return apiError(upload.error, upload.status);
  const uploaded = upload.uploaded;
  const markdown = isImageType(file.type)
    ? `![${file.name}](${uploaded.rawUrl})`
    : `[${file.name}](${uploaded.rawUrl})`;

  let audit: Awaited<ReturnType<typeof planning.recordAttachment>>["data"] = null;
  let effects: "confirmed" | "unconfirmed" = "unconfirmed";
  try {
    const result = await planning.recordAttachment(auditRequestMetadata(request));
    audit = result.data;
    if (!result.error && audit && result.taskSyncConfirmed) effects = "confirmed";
  } catch { /* Provider upload is already proven; a later audit failure must retain its editor result. */ }

  return NextResponse.json({
    ok: true,
    effects,
    ...(effects === "unconfirmed" ? { code: "attachment_uploaded_effects_unconfirmed", warning: "Anhang hochgeladen. Aktivität oder GitHub-Synchronisationsstatus sind noch nicht vollständig bestätigt." } : {}),
    filename: file.name,
    contentType: file.type,
    size: file.size,
    path,
    url: uploaded.rawUrl,
    htmlUrl: uploaded.htmlUrl,
    markdown,
    githubIssueNumber: resolveGitHubIssueNumber(task, { repository: task.github_repo }) || null,
    activity: audit ? {
      id: audit.id,
      taskId: audit.entity_id,
      action: audit.action,
      actorProfileId: audit.actor_profile_id || "",
      message: "",
      beforeData: audit.before_data,
      afterData: audit.after_data,
      createdAt: audit.created_at,
    } : null,
  });
}
