import { NextResponse, type NextRequest } from "next/server";
import { requireOperationalLead } from "@/lib/authz";
import { githubRepoSlug, upsertGitHubIssue } from "@/lib/github";
import { requireMatchingGitHubProviderToken } from "@/lib/github-provider-auth";
import { mapTaskRow, type TaskRowForMapping } from "@/lib/planning-task-mappers";
import type { Task } from "@/lib/types";
import { apiError, requireJsonApiContext } from "@/lib/api-response";

type SyncRequestBody = {
  createIfMissing?: boolean;
};

function hasLinkedGitHubIssue(task: Pick<Task, "githubIssueNumber" | "githubIssueUrl" | "issueNumber" | "issueUrl">) {
  return Boolean(
    task.githubIssueNumber ||
    task.githubIssueUrl ||
    task.issueNumber ||
    task.issueUrl.includes("github.com"),
  );
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<SyncRequestBody>(request, requireOperationalLead, {});
  if (!apiContext.ok) return apiContext.response;

  const { payload, permission, supabase } = apiContext;
  let githubUserToken = "";
  try {
    githubUserToken = await requireMatchingGitHubProviderToken(request, permission.profile, "GitHub-Verbindung fehlt. Bitte melde dich erneut mit GitHub an und starte die Spiegelung erneut.");
  } catch (tokenError) {
    const message = tokenError instanceof Error ? tokenError.message : "GitHub-Verbindung konnte nicht geprüft werden.";
    return apiError(message, 401);
  }

  const { id } = await context.params;
  const { data, error } = await supabase.from("tasks").select("*").eq("id", id).single();
  if (error || !data) return apiError(error?.message || "Aufgabe nicht gefunden.", 404);

  const profileNameById = new Map<string, string>();
  const involvedProfileIds = [data.owner, data.assignee].filter((value): value is string => typeof value === "string" && Boolean(value));
  if (involvedProfileIds.length) {
    const profiles = await supabase.from("profiles").select("id,name").in("id", involvedProfileIds);
    for (const profile of profiles.data || []) profileNameById.set(profile.id, profile.name);
  }
  const task = mapTaskRow(data as TaskRowForMapping, profileNameById);
  const hasExistingGitHubIssue = hasLinkedGitHubIssue(task);

  if (!hasExistingGitHubIssue && task.taskType !== "deliverable") {
    return NextResponse.json({
      error: "Nur Deliverables können extern angelegt werden.",
      task: {
        githubSyncStatus: task.githubSyncStatus,
        githubSyncError: task.githubSyncError,
      },
    }, { status: 400 });
  }

  if (!hasExistingGitHubIssue && !payload.createIfMissing) {
    return NextResponse.json({
      error: "Diese Aufgabe liegt nur in der App. Ein neues Issue wird nur über eine bewusste Anlegen-Aktion erstellt.",
      task: {
        githubSyncStatus: task.githubSyncStatus,
        githubSyncError: "",
      },
    }, { status: 409 });
  }

  await supabase.from("tasks").update({ github_sync_status: "pending", github_sync_error: null }).eq("id", id);

  try {
    const issue = await upsertGitHubIssue(task, githubUserToken);
    const syncedAt = new Date().toISOString();
    const githubRepo = githubRepoSlug();

    await supabase.from("tasks").update({
      github_repo: githubRepo,
      github_issue_number: issue.number,
      github_issue_url: issue.html_url,
      github_sync_status: "synced",
      github_last_synced_at: syncedAt,
      github_sync_error: null,
    }).eq("id", id);
    await supabase.from("task_activity").insert({
      task_id: id,
      message: `GitHub-Spiegelung ausgeführt: ${githubRepo}#${issue.number}`,
    });

    return NextResponse.json({
      ok: true,
      issue,
      task: {
        githubRepo,
        githubIssueNumber: issue.number,
        githubIssueUrl: issue.html_url,
        githubSyncStatus: "synced",
        githubLastSyncedAt: syncedAt,
        githubSyncError: "",
      },
    });
  } catch (syncError) {
    const message = syncError instanceof Error ? syncError.message : "GitHub-Spiegelung fehlgeschlagen.";
    await supabase.from("tasks").update({ github_sync_status: "failed", github_sync_error: message }).eq("id", id);
    await supabase.from("task_activity").insert({
      task_id: id,
      message: `GitHub-Spiegelung fehlgeschlagen: ${message}`,
    });
    return NextResponse.json({
      error: message,
      task: {
        githubSyncStatus: "failed",
        githubSyncError: message,
      },
    }, { status: 502 });
  }
}
