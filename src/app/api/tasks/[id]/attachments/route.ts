import { NextResponse, type NextRequest } from "next/server";
import { requirePlanningContributor } from "@/lib/authz";
import { uploadGitHubAttachment } from "@/lib/github";
import { GitHubAppUserTokenRequiredError, getGitHubUserTokenForProfile } from "@/lib/github-app";
import { resolveGitHubIssueNumber } from "@/lib/github-issue-reference";
import { compactAlphanumeric, slugify } from "@/lib/slug";
import { apiError, requireApiContext } from "@/lib/api-response";
import { auditRequestMetadata } from "@/lib/api-input";
import { requireActivePlanningItem } from "@/lib/planning-trash-mutation-guard";
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
  const apiContext = await requireApiContext(request, requirePlanningContributor);
  if (!apiContext.ok) return apiContext.response;

  const { permission, supabase } = apiContext;

  const { id } = await context.params;
  const activeItem = await requireActivePlanningItem(supabase, id);
  if (!activeItem.ok) return apiError(activeItem.error, activeItem.status);
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id,title,task_type,assignee,owner,status,review_owner_profile_id,review_status,score_final,github_repo,github_issue_number,issue_number")
    .eq("id", id)
    .single();

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

  let githubUserToken = "";
  try {
    githubUserToken = await getGitHubUserTokenForProfile(supabase, permission.profile);
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "GitHub-Verbindung konnte nicht geprüft werden.", error instanceof GitHubAppUserTokenRequiredError ? 401 : 403);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `${timestamp}-${safeFileName(file.name)}`;
  const path = `.fmd-attachments/tasks/${id}/${filename}`;
  const buffer = Buffer.from(await file.arrayBuffer());
  const uploaded = await uploadGitHubAttachment(
    path,
    buffer,
    githubUserToken,
    `Add attachment for Founder Scoreboard task ${id}`,
    task.github_repo,
  );
  const markdown = isImageType(file.type)
    ? `![${file.name}](${uploaded.rawUrl})`
    : `[${file.name}](${uploaded.rawUrl})`;

  const { data: audit, error: auditError } = await supabase.from("audit_log").insert({
    entity_type: "task",
    entity_id: id,
    action: "task.attachment_uploaded",
    actor_profile_id: permission.profile?.id || null,
    after_data: {
      filename: file.name,
      contentType: file.type,
      size: file.size,
      url: uploaded.rawUrl,
    },
    ...auditRequestMetadata(request),
  }).select("id,entity_id,action,actor_profile_id,before_data,after_data,created_at").single();
  if (auditError || !audit) return apiError(auditError?.message || "Anhang konnte nicht protokolliert werden.", 500);
  await supabase.from("tasks").update({
    github_issue_sync_status: "not_synced",
    github_issue_sync_error: null,
  }).eq("id", id);

  return NextResponse.json({
    ok: true,
    filename: file.name,
    contentType: file.type,
    size: file.size,
    path,
    url: uploaded.rawUrl,
    htmlUrl: uploaded.htmlUrl,
    markdown,
    githubIssueNumber: resolveGitHubIssueNumber(task, { repository: task.github_repo }) || null,
    activity: {
      id: audit.id,
      taskId: audit.entity_id,
      action: audit.action,
      actorProfileId: audit.actor_profile_id || "",
      message: "",
      beforeData: audit.before_data,
      afterData: audit.after_data,
      createdAt: audit.created_at,
    },
  });
}
