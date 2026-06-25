import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireOperationalLead } from "@/lib/authz";
import { githubRepoSlug, syncGitHubIssueDependencies, upsertGitHubIssue, type GitHubIssueDependencyInput } from "@/lib/github";
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

type RelationshipRow = {
  id: number;
  task_id: string;
  related_task_id: string;
  relation_type: "blocked_by" | "blocks" | "relates_to";
};

type RelationshipTaskRow = {
  id: string;
  github_repo?: string | null;
  github_issue_number?: number | null;
  github_issue_url?: string | null;
  issue_number?: string | null;
  issue_url?: string | null;
};

type SyncProfileRow = {
  id: string;
  name: string;
  github_login?: string | null;
};

function issueFromGitHubUrl(value?: string | null) {
  const match = (value || "").match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:$|[?#])/i);
  if (!match) return null;
  return {
    repo: `${match[1]}/${match[2]}`,
    number: Number(match[3]),
  };
}

function rowIssueNumber(row: RelationshipTaskRow, currentTaskId: string, currentIssueNumber: number) {
  const syncRepo = githubRepoSlug();
  if (row.id === currentTaskId) return currentIssueNumber;
  if (row.github_issue_number && (!row.github_repo || row.github_repo === syncRepo)) return row.github_issue_number;

  const githubIssue = issueFromGitHubUrl(row.github_issue_url);
  if (githubIssue?.repo === syncRepo) return githubIssue.number;

  const legacyIssueNumber = Number(row.issue_number || 0);
  if (Number.isInteger(legacyIssueNumber) && legacyIssueNumber > 0 && (!row.github_repo || row.github_repo === syncRepo)) return legacyIssueNumber;

  const legacyIssue = issueFromGitHubUrl(row.issue_url);
  return legacyIssue?.repo === syncRepo ? legacyIssue.number : null;
}

async function githubDependencyContext(supabase: SupabaseClient, taskId: string, currentIssueNumber: number) {
  const [outgoingRelationships, incomingRelationships, linkedTasks] = await Promise.all([
    supabase
      .from("task_relationship_edges")
      .select("id,task_id,related_task_id,relation_type")
      .eq("task_id", taskId)
      .in("relation_type", ["blocked_by", "blocks"]),
    supabase
      .from("task_relationship_edges")
      .select("id,task_id,related_task_id,relation_type")
      .eq("related_task_id", taskId)
      .in("relation_type", ["blocked_by", "blocks"]),
    supabase
      .from("tasks")
      .select("id,github_repo,github_issue_number,github_issue_url,issue_number,issue_url"),
  ]);

  if (outgoingRelationships.error) throw new Error(outgoingRelationships.error.message);
  if (incomingRelationships.error) throw new Error(incomingRelationships.error.message);
  if (linkedTasks.error) throw new Error(linkedTasks.error.message);

  const issueNumberByTaskId = new Map<string, number>();
  const managedIssueNumbers = new Set<number>();
  for (const row of (linkedTasks.data || []) as RelationshipTaskRow[]) {
    const issueNumber = rowIssueNumber(row, taskId, currentIssueNumber);
    if (!issueNumber) continue;
    issueNumberByTaskId.set(row.id, issueNumber);
    managedIssueNumbers.add(issueNumber);
  }

  const relationshipById = new Map<number, RelationshipRow>();
  for (const relationship of [...(outgoingRelationships.data || []), ...(incomingRelationships.data || [])] as RelationshipRow[]) {
    relationshipById.set(relationship.id, relationship);
  }

  const desiredDependencies = new Map<string, GitHubIssueDependencyInput>();
  for (const relationship of relationshipById.values()) {
    const blockedTaskId = relationship.relation_type === "blocks" ? relationship.related_task_id : relationship.task_id;
    const blockingTaskId = relationship.relation_type === "blocks" ? relationship.task_id : relationship.related_task_id;
    const blockedIssueNumber = issueNumberByTaskId.get(blockedTaskId);
    const blockingIssueNumber = issueNumberByTaskId.get(blockingTaskId);
    if (!blockedIssueNumber || !blockingIssueNumber) continue;

    desiredDependencies.set(`${blockedIssueNumber}:${blockingIssueNumber}`, {
      blockedIssueNumber,
      blockingIssueNumber,
    });
  }

  return {
    currentIssueNumber,
    desiredDependencies: [...desiredDependencies.values()],
    managedIssueNumbers: [...managedIssueNumbers],
  };
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
  const profileGitHubLoginById = new Map<string, string>();
  const involvedProfileIds = [data.owner, data.assignee].filter((value): value is string => typeof value === "string" && Boolean(value));
  if (involvedProfileIds.length) {
    const profiles = await supabase.from("profiles").select("id,name,github_login").in("id", involvedProfileIds);
    for (const profile of (profiles.data || []) as SyncProfileRow[]) {
      profileNameById.set(profile.id, profile.name);
      if (profile.github_login) profileGitHubLoginById.set(profile.id, profile.github_login);
    }
  }
  const task = mapTaskRow(data as TaskRowForMapping, profileNameById);
  const assigneeProfileId = data.owner || data.assignee || "";
  const assigneeLogin = assigneeProfileId ? profileGitHubLoginById.get(assigneeProfileId) || "" : "";
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
    const issue = await upsertGitHubIssue(task, githubUserToken, { login: assigneeLogin });
    const dependencyContext = await githubDependencyContext(supabase, id, issue.number);
    await syncGitHubIssueDependencies(dependencyContext, githubUserToken);
    const syncedAt = new Date().toISOString();
    const githubRepo = githubRepoSlug();
    const warnings = issue.warnings || [];

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
      message: [`GitHub-Spiegelung ausgeführt: ${githubRepo}#${issue.number}`, ...warnings.map((warning) => `Warnung: ${warning}`)].join(" · "),
    });

    return NextResponse.json({
      ok: true,
      issue,
      warnings,
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
