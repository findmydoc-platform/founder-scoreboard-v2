import { NextResponse, type NextRequest } from "next/server";
import { requirePlanningContributor } from "@/lib/authz";
import { uploadGitHubAttachment } from "@/lib/github";
import { GitHubAppUserTokenRequiredError, getGitHubUserTokenForProfile } from "@/lib/github-app";
import { resolveGitHubIssueNumber } from "@/lib/github-issue-reference";
import { compactAlphanumeric, slugify } from "@/lib/slug";
import { apiError, requireApiContext } from "@/lib/api-response";
import { requireActivePlanningItem } from "@/lib/planning-trash-mutation-guard";

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
  const activeItem = await requireActivePlanningItem(supabase, "tasks", id);
  if (!activeItem.ok) return apiError(activeItem.error, activeItem.status);
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id,title,github_repo,github_issue_number,issue_number")
    .eq("id", id)
    .single();

  if (taskError || !task) return apiError("Aufgabe wurde nicht gefunden.", 404);

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

  await supabase.from("task_activity").insert({
    task_id: id,
    message: `Anhang hochgeladen: ${file.name}`,
  });
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
  });
}
