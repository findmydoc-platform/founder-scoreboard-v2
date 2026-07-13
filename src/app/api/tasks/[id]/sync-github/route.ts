import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireTeamMember } from "@/lib/authz";
import { connectGitHubSubIssue, githubRepoSlug, syncGitHubIssueDependencies, upsertGitHubIssue, type GitHubIssueDependencyInput } from "@/lib/github";
import { getGitHubAppInstallationToken } from "@/lib/github-app";
import { deliverPendingGitHubComments } from "@/lib/github-comment-delivery";
import { resolveGitHubIssueNumber } from "@/lib/github-issue-reference";
import { resolveTaskGitHubRepository } from "@/lib/github-repositories";
import { preflightGitHubSubIssueParent, type GitHubSubIssueParentContext } from "@/lib/github-sub-issue-parent";
import { mapTaskRow, type TaskRowForMapping } from "@/lib/planning-task-mappers";
import type { Task } from "@/lib/types";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";
import { requireActivePlanningItem } from "@/lib/planning-trash-mutation-guard";

type SyncRequestBody = {
  createIfMissing?: boolean;
};

function commentDeliveryNotice(summary: {
  delivered: number;
  waitingForAuthorConnection: number;
  waitingForIssue: number;
  retryScheduled: number;
  failed: number;
}) {
  const parts = [
    summary.delivered ? `${summary.delivered} zugestellt` : "",
    summary.waitingForAuthorConnection ? `${summary.waitingForAuthorConnection} warten auf die Verbindung ihrer Autoren` : "",
    summary.waitingForIssue ? `${summary.waitingForIssue} warten auf ein Issue` : "",
    summary.retryScheduled ? `${summary.retryScheduled} für erneuten Versuch eingeplant` : "",
    summary.failed ? `${summary.failed} technisch fehlgeschlagen` : "",
  ].filter(Boolean);
  return parts.length ? `Issue synchronisiert · Kommentare: ${parts.join(" · ")}.` : "";
}

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

function githubSyncResourceKey(task: Task, createIfMissing: boolean) {
  const repository = githubRepoSlug(task.githubRepo);
  const issueNumber = resolveGitHubIssueNumber(task, { repository });
  if (issueNumber) return `github:${repository}#${issueNumber}`;
  return createIfMissing ? `task:${task.id}:${repository}:create-github-issue` : `task:${task.id}:${repository}:github-sync`;
}

function rowIssueNumber(row: RelationshipTaskRow, currentTaskId: string, currentIssueNumber: number, syncRepo: string) {
  if (row.id === currentTaskId) return currentIssueNumber;
  if (row.github_repo && row.github_repo !== syncRepo) return null;
  return resolveGitHubIssueNumber(row, { repository: syncRepo });
}

async function githubDependencyContext(supabase: SupabaseClient, taskId: string, currentIssueNumber: number, syncRepo: string) {
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
      .from(ACTIVE_TASKS_TABLE)
      .select("id,github_repo,github_issue_number,github_issue_url,issue_number,issue_url"),
  ]);

  if (outgoingRelationships.error) throw new Error(outgoingRelationships.error.message);
  if (incomingRelationships.error) throw new Error(incomingRelationships.error.message);
  if (linkedTasks.error) throw new Error(linkedTasks.error.message);

  const issueNumberByTaskId = new Map<string, number>();
  const managedIssueNumbers = new Set<number>();
  for (const row of (linkedTasks.data || []) as RelationshipTaskRow[]) {
    const issueNumber = rowIssueNumber(row, taskId, currentIssueNumber, syncRepo);
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
    repository: syncRepo,
  };
}

async function loadTaskForSync(supabase: SupabaseClient, id: string): Promise<LoadedSyncTask> {
  const { data, error } = await supabase.from(ACTIVE_TASKS_TABLE).select("*").eq("id", id).single();
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
  if (task.taskType === "sub_issue" && task.parentTaskId) {
    const { data: parent } = await supabase.from(ACTIVE_TASKS_TABLE).select("approval_status").eq("id", task.parentTaskId).maybeSingle();
    task.parentApprovalStatus = (parent?.approval_status as Task["parentApprovalStatus"]) || null;
  }
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

  const loaded = await loadTaskForSync(supabase, id);
  if (!loaded.ok) return loaded.response;

  let { assigneeLogin, hasExistingGitHubIssue, task } = loaded;

  const initialRepositoryPolicy = resolveTaskGitHubRepository(task.taskType, task.githubRepo);
  if (!initialRepositoryPolicy.ok) return apiError(initialRepositoryPolicy.error, 409);

  if (task.taskType === "deliverable" && task.approvalStatus !== "approved") {
    return apiError("Nur freigegebene Deliverables können mit GitHub synchronisiert werden.", 409);
  }
  if (task.taskType === "sub_issue" && task.parentApprovalStatus !== "approved") {
    return apiError("Das Parent-Deliverable muss vor dem GitHub-Sync freigegeben sein.", 409);
  }

  if (!hasExistingGitHubIssue && !payload.createIfMissing) {
    return NextResponse.json({
      error: "Diese Aufgabe hat noch kein GitHub Issue. Ein neues Issue wird nur über eine bewusste Anlegen-Aktion erstellt.",
      task: {
        githubIssueSyncStatus: task.githubIssueSyncStatus,
        githubIssueSyncError: "",
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
        githubIssueSyncStatus: "pending",
        githubIssueSyncError: "GitHub-Sync läuft bereits.",
      },
    }, { status: 409 });
  }

  try {
    const reloadedActiveItem = await requireActivePlanningItem(supabase, "tasks", id);
    if (!reloadedActiveItem.ok) return apiError(reloadedActiveItem.error, reloadedActiveItem.status);
    const reloaded = await loadTaskForSync(supabase, id);
    if (!reloaded.ok) return reloaded.response;
    ({ assigneeLogin, hasExistingGitHubIssue, task } = reloaded);

    const reloadedRepositoryPolicy = resolveTaskGitHubRepository(task.taskType, task.githubRepo);
    if (!reloadedRepositoryPolicy.ok) return apiError(reloadedRepositoryPolicy.error, 409);

    if (task.taskType === "deliverable" && task.approvalStatus !== "approved") return apiError("Nur freigegebene Deliverables können mit GitHub synchronisiert werden.", 409);

    if (!hasExistingGitHubIssue && !payload.createIfMissing) {
      return NextResponse.json({
        error: "Diese Aufgabe hat noch kein GitHub Issue. Ein neues Issue wird nur über eine bewusste Anlegen-Aktion erstellt.",
        task: {
          githubIssueSyncStatus: task.githubIssueSyncStatus,
          githubIssueSyncError: "",
        },
      }, { status: 409 });
    }

    let parentContext: GitHubSubIssueParentContext | null = null;
    if (task.taskType === "sub_issue") {
      parentContext = await preflightGitHubSubIssueParent(supabase, task, githubInstallationToken);
    }

    const { error: pendingError } = await supabase.rpc("begin_github_issue_sync_transaction", {
      p_task_id: id,
    });
    if (pendingError) throw new Error(`GitHub-Sync konnte nicht gestartet werden: ${pendingError.message}`);

    const issue = await upsertGitHubIssue(task, githubInstallationToken, { login: assigneeLogin });
    const githubRepo = githubRepoSlug(task.githubRepo);
    if (task.taskType === "deliverable") {
      const dependencyContext = await githubDependencyContext(supabase, id, issue.number, githubRepo);
      await syncGitHubIssueDependencies(dependencyContext, githubInstallationToken);
    } else if (parentContext) {
      await connectGitHubSubIssue({
        parentRepository: parentContext.repository,
        parentIssueNumber: parentContext.issueNumber,
        childRepository: githubRepo,
        childIssueNumber: issue.number,
        token: githubInstallationToken,
      });
    }
    const syncedAt = new Date().toISOString();
    const warnings = issue.warnings || [];
    const activityMessage = [
      `GitHub-Sync ausgeführt: ${githubRepo}#${issue.number}`,
      issue.recovered ? "Vorhandenes FounderOps-Issue wiederverwendet" : "",
      ...warnings.map((warning) => `Warnung: ${warning}`),
    ].filter(Boolean).join(" · ");

    const { data: finalizedTask, error: finalizeError } = await supabase.rpc("finalize_github_issue_sync_transaction", {
      p_task_id: id,
      p_github_repo: githubRepo,
      p_github_issue_number: issue.number,
      p_github_issue_url: issue.html_url,
      p_synced_at: syncedAt,
      p_activity_message: activityMessage,
    });
    if (finalizeError) throw new Error(`GitHub Issue wurde gespeichert, aber die Verknüpfung ist fehlgeschlagen: ${finalizeError.message}`);

    const commentDelivery = await deliverPendingGitHubComments({ supabase, taskId: id }).catch(() => ({
      delivered: 0,
      reconciled: 0,
      created: 0,
      waitingForAuthorConnection: 0,
      waitingForIssue: 0,
      retryScheduled: 0,
      failed: 1,
    }));
    const commentNotice = commentDeliveryNotice(commentDelivery);

    return NextResponse.json({
      ok: true,
      issue,
      warnings,
      commentDelivery,
      notices: commentNotice ? [{
        code: "github_comment_delivery_summary",
        level: "info",
        message: commentNotice,
      }] : [],
      task: {
        githubRepo,
        githubIssueNumber: issue.number,
        githubIssueUrl: issue.html_url,
        githubIssueSyncStatus: "synced",
        githubIssueLastSyncedAt: syncedAt,
        githubIssueSyncError: "",
        updatedAt: finalizedTask?.updated_at || "",
      },
    });
  } catch (syncError) {
    const message = syncError instanceof Error ? syncError.message : "GitHub-Sync fehlgeschlagen.";
    const { data: failedTask } = await supabase.rpc("fail_github_issue_sync_transaction", {
      p_task_id: id,
      p_error_message: message,
      p_activity_message: `GitHub-Sync fehlgeschlagen: ${message}`,
    });
    return NextResponse.json({
      error: message,
      task: {
        githubIssueSyncStatus: "failed",
        githubIssueSyncError: message,
        updatedAt: failedTask?.updated_at || "",
      },
    }, { status: 502 });
  } finally {
    await releaseGitHubSyncLock(supabase, resourceKey, lockToken);
  }
}
