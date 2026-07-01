import { NextResponse, type NextRequest } from "next/server";
import { requireFounder } from "@/lib/authz";
import { getGitHubIssue, listGitHubIssueComments } from "@/lib/github";
import { getGitHubAppInstallationToken } from "@/lib/github-app";
import { apiError, requireApiContext } from "@/lib/api-response";

function isAppMirroredComment(body: string) {
  return /<!--\s*fmd-comment-id:\d+\s*-->/.test(body);
}

function extractEvidenceFromIssueBody(body: string) {
  const match = body.match(/##\s*Evidence Link[^\n]*\n([\s\S]*?)(?=\n##\s+|$)/i);
  if (!match) return "";
  const evidence = match[1].trim();
  if (!evidence || /^_?No response\.?_?$/i.test(evidence)) return "";
  return evidence.slice(0, 4000);
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireApiContext(request, requireFounder);
  if (!apiContext.ok) return apiContext.response;

  const { supabase } = apiContext;

  let githubInstallationToken = "";
  try {
    githubInstallationToken = await getGitHubAppInstallationToken();
  } catch (tokenError) {
    const message = tokenError instanceof Error ? tokenError.message : "GitHub-Verbindung konnte nicht geprüft werden.";
    return apiError(message, 401);
  }

  const { id } = await context.params;
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id,title,evidence_link,issue_url,github_issue_number,issue_number")
    .eq("id", id)
    .single();

  if (taskError || !task) return apiError("Aufgabe wurde nicht gefunden.", 404);

  const issueNumber = Number(task.github_issue_number || task.issue_number || 0);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    return apiError("Diese Aufgabe ist noch nicht extern abgelegt.", 409);
  }

  let githubComments: Awaited<ReturnType<typeof listGitHubIssueComments>>;
  let importedEvidenceLink = "";
  try {
    const [issue, comments] = await Promise.all([
      getGitHubIssue(issueNumber, githubInstallationToken),
      listGitHubIssueComments(issueNumber, githubInstallationToken),
    ]);
    githubComments = comments;
    importedEvidenceLink = extractEvidenceFromIssueBody(issue.body || "");
  } catch (githubError) {
    const message = githubError instanceof Error ? githubError.message : "GitHub-Kommentare konnten nicht geladen werden.";
    return NextResponse.json(
      {
        error: `${message}. Falls es danach weiter fehlschlägt, muss die GitHub App Zugriff auf findmydoc-platform/management haben.`,
      },
      { status: 502 },
    );
  }

  const currentEvidence = String(task.evidence_link || "").trim();
  if (importedEvidenceLink && (!currentEvidence || currentEvidence === String(task.issue_url || "").trim())) {
    const { error: evidenceError } = await supabase
      .from("tasks")
      .update({
        evidence_link: importedEvidenceLink,
        github_sync_status: "not_synced",
        github_sync_error: null,
      })
      .eq("id", id);
    if (evidenceError) return apiError(evidenceError.message, 500);
    await supabase.from("task_activity").insert({
      task_id: id,
      message: "Nachweis aus externer Ablage importiert",
    });
  } else {
    importedEvidenceLink = "";
  }
  const externalRows = githubComments
    .filter((comment) => comment.body?.trim() && !isAppMirroredComment(comment.body))
    .map((comment) => ({
      task_id: id,
      source: "github",
      external_id: String(comment.id),
      author_login: comment.user?.login || "github-user",
      author_avatar_url: comment.user?.avatar_url || null,
      body: comment.body.trim(),
      html_url: comment.html_url || null,
      created_at: comment.created_at,
      imported_at: new Date().toISOString(),
    }));

  let newExternalRows = externalRows;
  if (externalRows.length) {
    const { data: existingRows, error: existingError } = await supabase
      .from("task_external_comments")
      .select("external_id")
      .eq("task_id", id)
      .eq("source", "github")
      .in("external_id", externalRows.map((row) => row.external_id));

    if (existingError) return apiError(existingError.message, 500);

    const existingIds = new Set((existingRows || []).map((row) => row.external_id));
    newExternalRows = externalRows.filter((row) => !existingIds.has(row.external_id));

    const { error: upsertError } = await supabase
      .from("task_external_comments")
      .upsert(externalRows, { onConflict: "source,external_id" });
    if (upsertError) return apiError(upsertError.message, 500);
  }

  if (newExternalRows.length) {
    await supabase.from("task_activity").insert({
      task_id: id,
      message: `GitHub-Kommentare importiert: ${newExternalRows.length} neue externe Kommentare`,
    });
  }

  const { data: importedComments, error: importedError } = await supabase
    .from("task_external_comments")
    .select("id,task_id,source,external_id,author_login,author_avatar_url,body,html_url,created_at,imported_at")
    .eq("task_id", id)
    .order("created_at", { ascending: true });

  if (importedError) return apiError(importedError.message, 500);

  return NextResponse.json({
    ok: true,
    imported: newExternalRows.length,
    evidenceLink: importedEvidenceLink,
    comments: (importedComments || []).map((comment) => ({
      id: comment.id,
      taskId: comment.task_id,
      source: comment.source,
      externalId: comment.external_id,
      authorLogin: comment.author_login,
      authorAvatarUrl: comment.author_avatar_url || "",
      body: comment.body,
      htmlUrl: comment.html_url || "",
      createdAt: comment.created_at,
      importedAt: comment.imported_at,
    })),
  });
}
