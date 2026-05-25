import { NextResponse, type NextRequest } from "next/server";
import { requireFounder } from "@/lib/authz";
import { githubUserForToken, uploadGitHubAttachment } from "@/lib/github";
import { getServerSupabase } from "@/lib/supabase";

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

function providerToken(request: NextRequest) {
  return request.headers.get("x-github-provider-token")?.trim() || "";
}

function safeFileName(value: string) {
  const fallback = "anhang";
  const trimmed = value.trim() || fallback;
  const parts = trimmed.split(".");
  const extension = parts.length > 1 ? parts.pop() || "" : "";
  const base = (parts.join(".") || trimmed)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || fallback;
  return extension ? `${base}.${extension.toLowerCase().replace(/[^a-z0-9]/g, "")}` : base;
}

function isImageType(type: string) {
  return type.toLowerCase().startsWith("image/");
}

async function requireMatchingGitHubToken(request: NextRequest, profile: { githubLogin?: string } | null) {
  const token = providerToken(request);
  if (!token) throw new Error("GitHub User-Token fehlt. Bitte erneut mit GitHub anmelden und den Upload wiederholen.");

  const githubUser = await githubUserForToken(token);
  const expectedLogin = profile?.githubLogin?.toLowerCase() || "";
  if (!expectedLogin || githubUser.login.toLowerCase() !== expectedLogin) {
    throw new Error("GitHub User-Token passt nicht zum angemeldeten Teamprofil.");
  }

  return token;
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireFounder(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  const { id } = await context.params;
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id,title,github_issue_number,issue_number")
    .eq("id", id)
    .single();

  if (taskError || !task) return NextResponse.json({ error: "Aufgabe wurde nicht gefunden." }, { status: 404 });

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Datei ist erforderlich." }, { status: 400 });
  if (file.size <= 0) return NextResponse.json({ error: "Datei ist leer." }, { status: 400 });
  if (file.size > maxUploadBytes) return NextResponse.json({ error: "Datei ist zu groß. Maximal erlaubt sind 10 MB." }, { status: 413 });
  if (!allowedMimeTypes.has(file.type)) return NextResponse.json({ error: "Dateityp wird noch nicht unterstützt." }, { status: 415 });

  let githubUserToken = "";
  try {
    githubUserToken = await requireMatchingGitHubToken(request, permission.profile);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "GitHub User-Token konnte nicht geprüft werden." }, { status: 403 });
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
  );
  const markdown = isImageType(file.type)
    ? `![${file.name}](${uploaded.rawUrl})`
    : `[${file.name}](${uploaded.rawUrl})`;

  await supabase.from("task_activity").insert({
    task_id: id,
    message: `Anhang hochgeladen: ${file.name}`,
  });
  await supabase.from("tasks").update({
    github_sync_status: "not_synced",
    github_sync_error: null,
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
    githubIssueNumber: Number(task.github_issue_number || task.issue_number || 0) || null,
  });
}
