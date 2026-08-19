import { NextResponse, type NextRequest } from "next/server";
import { requireTeamMember } from "@/lib/authz";
import { getGitHubIssue, listGitHubIssueComments } from "@/lib/github";
import { getGitHubAppInstallationToken } from "@/lib/github-app";
import { resolveGitHubIssueNumber } from "@/lib/github-issue-reference";
import { resolveGitHubCommentMentionSnapshot } from "@/lib/github-comment-mention-snapshot";
import { importGitHubTaskCommentsWithMentions } from "@/lib/github-comment-mention-import";
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
  const activeItem = await requireActivePlanningItem(supabase, id);
  if (!activeItem.ok) return apiError(activeItem.error, activeItem.status);

  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id,title,assignee,owner,status,review_owner_profile_id,review_status,score_final,evidence_link,issue_url,github_repo,github_issue_number,issue_number,task_type")
    .eq("id", id)
    .single();

  if (taskError || !task) return apiError("Aufgabe wurde nicht gefunden.", 404);
  if (task.task_type === "epic" || task.task_type === "initiative") {
    return apiError("Strategische Planungselemente haben keine GitHub-Kommentare.", 400);
  }

  let githubInstallationToken = "";
  try {
    githubInstallationToken = await getGitHubAppInstallationToken();
  } catch (tokenError) {
    const message = tokenError instanceof Error ? tokenError.message : "GitHub-Verbindung konnte nicht geprüft werden.";
    return apiError(message, 401);
  }

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
      status: task.status || "",
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
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id,name,github_login");
  if (profilesError) return apiError(profilesError.message, 500);
  const mentionProfiles = (profiles || []).map((profile) => ({
    id: profile.id,
    name: profile.name,
    githubLogin: profile.github_login,
  }));
  const importableComments = githubComments.filter((comment) => comment.body?.trim() && !isAppMirroredComment(comment.body));
  const externalIds = importableComments.map((comment) => String(comment.id));
  let existingCommentRows: Array<{
    external_id: string;
    author_login: string;
    body: string;
    source_updated_at: string;
    mention_recipient_profile_ids: string[];
    mention_recipients_initialized: boolean;
  }> = [];
  if (externalIds.length) {
    const { data: existingComments, error: existingCommentsError } = await supabase
      .from("task_external_comments")
      .select("external_id,author_login,body,source_updated_at,mention_recipient_profile_ids,mention_recipients_initialized")
      .eq("source", "github")
      .in("external_id", externalIds);
    if (existingCommentsError) return apiError(existingCommentsError.message, 500);
    existingCommentRows = existingComments || [];
  }
  const existingCommentsByExternalId = new Map(existingCommentRows.map((comment) => [comment.external_id, comment]));
  const importedAt = new Date().toISOString();
  const externalRows = importableComments
    .map((comment) => {
      const authorLogin = comment.user?.login || "github-user";
      const existing = existingCommentsByExternalId.get(String(comment.id));
      const mentionSnapshot = resolveGitHubCommentMentionSnapshot({
        authorLogin,
        body: comment.body,
        profiles: mentionProfiles,
        existing: existing ? {
          authorLogin: existing.author_login,
          body: existing.body,
          sourceUpdatedAt: existing.source_updated_at,
          mentionRecipientProfileIds: existing.mention_recipient_profile_ids || [],
          mentionRecipientsInitialized: existing.mention_recipients_initialized,
        } : undefined,
      });
      return {
        externalId: String(comment.id),
        authorLogin,
        authorAvatarUrl: comment.user?.avatar_url || "",
        actorProfileId: mentionSnapshot.actorProfileId,
        mentionRecipientProfileIds: mentionSnapshot.mentionRecipientProfileIds,
        baselineMentionRecipientProfileIds: mentionSnapshot.baselineMentionRecipientProfileIds,
        baselineSourceUpdatedAt: mentionSnapshot.baselineSourceUpdatedAt,
        body: comment.body.trim(),
        htmlUrl: comment.html_url || "",
        createdAt: comment.created_at,
        sourceUpdatedAt: comment.updated_at || comment.created_at,
        importedAt,
      };
    });

  const { data: importResult, error: importError } = await importGitHubTaskCommentsWithMentions(supabase, id, externalRows);
  if (importError) return apiError(importError.message, 500);

  const { data: importedComments, error: importedError } = await supabase
    .from("task_external_comments")
    .select("id,task_id,source,external_id,author_login,author_avatar_url,body,html_url,created_at,imported_at")
    .eq("task_id", id)
    .order("created_at", { ascending: true });

  if (importedError) return apiError(importedError.message, 500);

  return NextResponse.json({
    ok: true,
    imported: Number(importResult?.imported || 0),
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
