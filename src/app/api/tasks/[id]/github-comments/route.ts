import { NextResponse, type NextRequest } from "next/server";
import { requireFounder } from "@/lib/authz";
import { getGitHubIssue, githubUserForToken, listGitHubIssueComments } from "@/lib/github";
import { getServerSupabase } from "@/lib/supabase";

function providerToken(request: NextRequest) {
  return request.headers.get("x-github-provider-token")?.trim() || "";
}

async function requireMatchingGitHubToken(request: NextRequest, profile: { githubLogin?: string } | null) {
  const token = providerToken(request);
  if (!token) throw new Error("GitHub User-Token fehlt. Bitte erneut mit GitHub anmelden und Kommentare aktualisieren.");

  const githubUser = await githubUserForToken(token);
  const expectedLogin = profile?.githubLogin?.toLowerCase() || "";
  if (!expectedLogin || githubUser.login.toLowerCase() !== expectedLogin) {
    throw new Error("GitHub User-Token passt nicht zum angemeldeten Teamprofil.");
  }

  return token;
}

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
  const supabase = getServerSupabase();
  if (!supabase) return NextResponse.json({ error: "Supabase env is not configured." }, { status: 501 });

  const permission = await requireFounder(request);
  if (!permission.ok) return NextResponse.json({ error: permission.error }, { status: permission.status });

  let githubUserToken = "";
  try {
    githubUserToken = await requireMatchingGitHubToken(request, permission.profile);
  } catch (tokenError) {
    const message = tokenError instanceof Error ? tokenError.message : "GitHub User-Token konnte nicht geprüft werden.";
    return NextResponse.json({ error: message }, { status: 401 });
  }

  const { id } = await context.params;
  const { data: task, error: taskError } = await supabase
    .from("tasks")
    .select("id,title,evidence_link,issue_url,github_issue_number,issue_number")
    .eq("id", id)
    .single();

  if (taskError || !task) return NextResponse.json({ error: "Aufgabe wurde nicht gefunden." }, { status: 404 });

  const issueNumber = Number(task.github_issue_number || task.issue_number || 0);
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
    return NextResponse.json({ error: "Diese Aufgabe ist noch nicht mit einem GitHub-Issue verknüpft." }, { status: 409 });
  }

  let githubComments: Awaited<ReturnType<typeof listGitHubIssueComments>>;
  let importedEvidenceLink = "";
  try {
    const [issue, comments] = await Promise.all([
      getGitHubIssue(issueNumber, githubUserToken),
      listGitHubIssueComments(issueNumber, githubUserToken),
    ]);
    githubComments = comments;
    importedEvidenceLink = extractEvidenceFromIssueBody(issue.body || "");
  } catch (githubError) {
    const message = githubError instanceof Error ? githubError.message : "GitHub-Kommentare konnten nicht geladen werden.";
    return NextResponse.json(
      {
        error: `${message}. Bitte einmal ausloggen und erneut mit GitHub anmelden. Falls es danach weiter fehlschlägt, muss die OAuth-App Zugriff auf die private Organisation findmydoc-platform bzw. das management-Repo bekommen.`,
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
    if (evidenceError) return NextResponse.json({ error: evidenceError.message }, { status: 500 });
    await supabase.from("task_activity").insert({
      task_id: id,
      message: "Evidence aus GitHub-Issue importiert",
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

    if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 });

    const existingIds = new Set((existingRows || []).map((row) => row.external_id));
    newExternalRows = externalRows.filter((row) => !existingIds.has(row.external_id));

    const { error: upsertError } = await supabase
      .from("task_external_comments")
      .upsert(externalRows, { onConflict: "source,external_id" });
    if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });
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

  if (importedError) return NextResponse.json({ error: importedError.message }, { status: 500 });

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
