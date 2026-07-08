import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTeamMember } from "@/lib/authz";
import { githubRepoSlug, syncGitHubIssueDependencies, upsertGitHubIssue, type GitHubIssueDependencyInput } from "@/lib/github";
import { getGitHubAppConnectionStatus, getGitHubAppInstallationToken } from "@/lib/github-app";
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

type LoadedSyncTask =
  | {
      ok: true;
      data: TaskRowForMapping & { owner?: string | null; assignee?: string | null };
      task: Task;
      assigneeLogin: string;
      hasExistingGitHubIssue: boolean;
    }
  | { ok: false; response: NextResponse };

function issueFromGitHubUrl(value?: string | null) {
  const match = (value || "").match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)(?:$|[?#])/i);
  if (!match) return null;
  return {
    repo: `${match[1]}/${match[2]}`,
    number: Number(match[3]),
  };
}

function linkedIssueNumber(task: Pick<Task, "githubIssueNumber" | "githubIssueUrl" | "issueNumber" | "issueUrl">) {
  if (task.githubIssueNumber) return task.githubIssueNumber;

  const githubIssue = issueFromGitHubUrl(task.githubIssueUrl);
  if (githubIssue?.repo === githubRepoSlug()) return githubIssue.number;

  const legacyNumber = Number(task.issueNumber || 0);
  if (Number.isInteger(legacyNumber) && legacyNumber > 0) return legacyNumber;

  const legacyIssue = issueFromGitHubUrl(task.issueUrl);
  return legacyIssue?.repo === githubRepoSlug() ? legacyIssue.number : null;
}

function githubSyncResourceKey(task: Task, createIfMissing: boolean) {
  const issueNumber = linkedIssueNumber(task);
  if (issueNumber) return `github:${githubRepoSlug()}#${issueNumber}`;
  return createIfMissing ? `task:${task.id}:create-github-issue` : `task:${task.id}:github-sync`;
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

async function loadTaskForSync(supabase: SupabaseClient, id: string): Promise<LoadedSyncTask> {
  const { data, error } = await supabase.from("tasks").select("*").eq("id", id).single();
  if (error || !data) return { ok: false, response: apiError(error?.message || "Aufgabe nicht gefunden.", 404) };

  const profileNameById = new Map<string, string>();
  const profileGitHubLoginById = new Map<string, string>();
  const involvedProfileIds = [data.assignee, data.owner].filter((value): value is string => typeof value === "string" && Boolean(value));
  if (involvedProfileIds.length) {
    const profiles = await supabase.from("profiles").select("id,name,github_login").in("id", involvedProfileIds);
    for (const profile of (profiles.data || []) as SyncProfileRow[]) {
      profileNameById.set(profile.id, profile.name);
      if (profile.github_login) profileGitHubLoginById.set(profile.id, profile.github_login);
    }
  }

  const task = mapTaskRow(data as TaskRowForMapping, profileNameById);
  const assigneeProfileId = data.assignee || "";
  const assigneeLogin = assigneeProfileId ? profileGitHubLoginById.get(assigneeProfileId) || "" : "";

  return {
    ok: true,
    data: data as TaskRowForMapping & { owner?: string | null; assignee?: string | null },
    task,
    assigneeLogin,
    hasExistingGitHubIssue: hasLinkedGitHubIssue(task),
  };
}

async function acquireGitHubSyncLock(supabase: SupabaseClient, resourceKey: string, taskId: string, profileId: string) {
  const { data, error } = await supabase.rpc("try_acquire_github_issue_sync_lock", {
    p_resource_key: resourceKey,
    p_task_id: taskId,
    p_locked_by_profile_id: profileId || null,
    p_ttl_seconds: 600,
  });
  if (error) throw new Error(`GitHub-Sync-Lock konnte nicht gesetzt werden: ${error.message}`);
  return typeof data === "string" && data ? data : null;
}

async function releaseGitHubSyncLock(supabase: SupabaseClient, resourceKey: string, lockToken: string) {
  await supabase.rpc("release_github_issue_sync_lock", {
    p_resource_key: resourceKey,
    p_lock_token: lockToken,
  });
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<SyncRequestBody>(request, requireTeamMember, {});
  if (!apiContext.ok) return apiContext.response;

  const { payload, permission, supabase } = apiContext;
  const githubConnection = await getGitHubAppConnectionStatus(supabase, permission.profile);
  if (!githubConnection.connected) {
    return NextResponse.json({
      code: "github_app_connection_required",
      error: "GitHub-App-Verbindung fehlt oder ist abgelaufen. Bitte verbinde GitHub einmal neu.",
    }, { status: 401 });
  }

  let githubInstallationToken = "";
  try {
    githubInstallationToken = await getGitHubAppInstallationToken();
  } catch (tokenError) {
    const message = tokenError instanceof Error ? tokenError.message : "GitHub-Verbindung konnte nicht geprüft werden.";
    return apiError(message, 401);
  }

  const { id } = await context.params;
  const loaded = await loadTaskForSync(supabase, id);
  if (!loaded.ok) return loaded.response;

  let { assigneeLogin, hasExistingGitHubIssue, task } = loaded;

  if (!hasExistingGitHubIssue && task.taskType !== "deliverable") {
    return NextResponse.json({
      error: "Nur Deliverables können als GitHub Issue angelegt werden.",
      task: {
        githubSyncStatus: task.githubSyncStatus,
        githubSyncError: task.githubSyncError,
      },
    }, { status: 400 });
  }

  if (!hasExistingGitHubIssue && !payload.createIfMissing) {
    return NextResponse.json({
      error: "Diese Aufgabe hat noch kein GitHub Issue. Ein neues Issue wird nur über eine bewusste Anlegen-Aktion erstellt.",
      task: {
        githubSyncStatus: task.githubSyncStatus,
        githubSyncError: "",
      },
    }, { status: 409 });
  }

  const resourceKey = githubSyncResourceKey(task, Boolean(payload.createIfMissing));
  let lockToken = "";
  try {
    lockToken = await acquireGitHubSyncLock(supabase, resourceKey, id, permission.profile?.id || "") || "";
  } catch (lockError) {
    const message = lockError instanceof Error ? lockError.message : "GitHub-Sync-Lock konnte nicht gesetzt werden.";
    return apiError(message, 500);
  }

  if (!lockToken) {
    return NextResponse.json({
      code: "github_sync_locked",
      error: "GitHub-Sync läuft bereits für diese Aufgabe oder dieses Issue.",
      task: {
        githubSyncStatus: "pending",
        githubSyncError: "GitHub-Sync läuft bereits.",
      },
    }, { status: 409 });
  }

  try {
    const reloaded = await loadTaskForSync(supabase, id);
    if (!reloaded.ok) return reloaded.response;
    ({ assigneeLogin, hasExistingGitHubIssue, task } = reloaded);

    if (!hasExistingGitHubIssue && task.taskType !== "deliverable") {
      return NextResponse.json({
        error: "Nur Deliverables können als GitHub Issue angelegt werden.",
        task: {
          githubSyncStatus: task.githubSyncStatus,
          githubSyncError: task.githubSyncError,
        },
      }, { status: 400 });
    }

    if (!hasExistingGitHubIssue && !payload.createIfMissing) {
      return NextResponse.json({
        error: "Diese Aufgabe hat noch kein GitHub Issue. Ein neues Issue wird nur über eine bewusste Anlegen-Aktion erstellt.",
        task: {
          githubSyncStatus: task.githubSyncStatus,
          githubSyncError: "",
        },
      }, { status: 409 });
    }

    await supabase.from("tasks").update({ github_sync_status: "pending", github_sync_error: null }).eq("id", id);

    const issue = await upsertGitHubIssue(task, githubInstallationToken, { login: assigneeLogin });
    const dependencyContext = await githubDependencyContext(supabase, id, issue.number);
    await syncGitHubIssueDependencies(dependencyContext, githubInstallationToken);
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
      message: [`GitHub-Sync ausgeführt: ${githubRepo}#${issue.number}`, ...warnings.map((warning) => `Warnung: ${warning}`)].join(" · "),
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
    const message = syncError instanceof Error ? syncError.message : "GitHub-Sync fehlgeschlagen.";
    await supabase.from("tasks").update({ github_sync_status: "failed", github_sync_error: message }).eq("id", id);
    await supabase.from("task_activity").insert({
      task_id: id,
      message: `GitHub-Sync fehlgeschlagen: ${message}`,
    });
    return NextResponse.json({
      error: message,
      task: {
        githubSyncStatus: "failed",
        githubSyncError: message,
      },
    }, { status: 502 });
  } finally {
    await releaseGitHubSyncLock(supabase, resourceKey, lockToken);
  }
}
