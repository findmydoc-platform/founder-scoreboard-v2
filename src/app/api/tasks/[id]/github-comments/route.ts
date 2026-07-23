import { NextResponse, type NextRequest } from "next/server";
import { requireTeamMember } from "@/lib/authz";
import { getGitHubIssue, listGitHubIssueComments } from "@/lib/github";
import { getGitHubAppInstallationToken } from "@/lib/github-app";
import { resolveGitHubIssueNumber } from "@/lib/github-issue-reference";
import { apiError, requireApiContext } from "@/lib/api-response";
import { taskDetailPermissions } from "@/features/tasks/model/task-detail-permissions";
import { requireActivePlanningItem } from "@/lib/planning-trash-mutation-guard";

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
  const apiContext = await requireApiContext(request, requireTeamMember);
  if (!apiContext.ok) return apiContext.response;

  const { permission, supabase } = apiContext;

  const { id } = await context.params;
  const activeItem = await requireActivePlanningItem(supabase, "tasks", id);
  if (!activeItem.ok) return apiError(activeItem.error, activeItem.status);

  let githubInstallationToken = "";
  try {
    githubInstallationToken = await getGitHubAppInstallationToken();
  } catch (tokenError) {
    const message = tokenError instanceof Error ? tokenError.message : "GitHub-Verbindung konnte nicht geprüft werden.";
    return apiError(message, 401);
  }

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id,title,assignee,owner,review_owner_profile_id,review_status,score_final,evidence_link,issue_url,github_repo,github_issue_number,issue_number,task_type")
    .eq("id", id)
    .single();

  if (taskError || !task) return apiError("Aufgabe wurde nicht gefunden.", 404);

  const issueNumber = resolveGitHubIssueNumber(task, { repository: task.github_repo });
  if (issueNumber === null || !Number.isInteger(issueNumber) || issueNumber <= 0) {
    return apiError("Diese Aufgabe hat noch kein GitHub Issue.", 409);
  }

  let githubComments: Awaited<ReturnType<typeof listGitHubIssueComments>>;
  let importedEvidenceLink = "";
  try {
    const [issue, comments] = await Promise.all([
      getGitHubIssue(issueNumber, githubInstallationToken, task.github_repo),
      listGitHubIssueComments(issueNumber, githubInstallationToken, task.github_repo),
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
  const evidencePermissions = taskDetailPermissions({
    task: {
      assignee: task.assignee || "",
      assigneeId: task.assignee || "",
      owner: task.owner || "",
      ownerId: task.owner || "",
      reviewOwnerProfileId: task.review_owner_profile_id || "",
      reviewStatus: task.review_status || "not_requested",
      scoreFinal: Boolean(task.score_final),
      taskType: task.task_type === "sub_issue" ? "sub_issue" : "deliverable",
    },
    profile: permission.profile,
    unrestricted: !permission.profile,
  });
  if (importedEvidenceLink && evidencePermissions.canEditEvidence && (!currentEvidence || currentEvidence === String(task.issue_url || "").trim())) {
    const { error: evidenceError } = await supabase
      .from("tasks")
      .update({
        evidence_link: importedEvidenceLink,
        github_issue_sync_status: "not_synced",
        github_issue_sync_error: null,
      })
      .eq("id", id);
    if (evidenceError) return apiError(evidenceError.message, 500);
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
