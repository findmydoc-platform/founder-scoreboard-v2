import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverPendingGitHubComments } from "../github-comment-delivery";
import { connectGitHubSubIssue, listGitHubIssueLinkedPullRequests } from "../github";
import {
  githubSyncStatePersistFailedMessage,
  persistGitHubSyncFailure,
} from "../github-sync-failure-persistence";
import { resolveGitHubIssueNumber } from "../github-issue-reference";
import { resolveTaskGitHubRepository } from "../github-repositories";
import {
  preflightGitHubSubIssueParent,
  type GitHubSubIssueParentContext,
} from "../github-sub-issue-parent";
import { mapTaskRow, type TaskRowForMapping } from "../planning-task-mappers";
import { ACTIVE_TASKS_TABLE } from "../planning-read-model";
import { requireActivePlanningItem } from "../planning-trash-mutation-guard";
import type { Task } from "../types";
import {
  taskGitHubSyncFailure,
  type GitHubCommentDeliverySummary,
  type TaskGitHubProjectionResult,
} from "./contract";
import { projectTaskGitHubDependencies } from "./dependency-projection";
import { projectTaskGitHubIssue } from "./issue-projection";
import { projectTaskToFounderOpsGitHubProject } from "./project-projection";

type SyncProfileRow = {
  id: string;
  name: string;
  github_login?: string | null;
};

type LoadedSyncTask = {
  data: TaskRowForMapping & { owner?: string | null; assignee?: string | null };
  task: Task;
  assigneeLogin: string;
};

const staleSyncMessage = "Die Aufgabe wurde während des GitHub-Syncs geändert. Bitte prüfe den aktuellen Stand und starte den Sync erneut.";
const creationRequiredMessage = "Diese Aufgabe hat noch kein GitHub Issue. Ein neues Issue wird nur über eine bewusste Anlegen-Aktion erstellt.";

const emptyCommentDelivery = (failed = 0): GitHubCommentDeliverySummary => ({
  delivered: 0,
  reconciled: 0,
  created: 0,
  waitingForAuthorConnection: 0,
  waitingForIssue: 0,
  retryScheduled: 0,
  failed,
});

function commentDeliveryNotice(summary: GitHubCommentDeliverySummary) {
  const parts = [
    summary.delivered ? `${summary.delivered} zugestellt` : "",
    summary.waitingForAuthorConnection ? `${summary.waitingForAuthorConnection} warten auf die Verbindung ihrer Autoren` : "",
    summary.waitingForIssue ? `${summary.waitingForIssue} warten auf ein Issue` : "",
    summary.retryScheduled ? `${summary.retryScheduled} für erneuten Versuch eingeplant` : "",
    summary.failed ? `${summary.failed} technisch fehlgeschlagen` : "",
  ].filter(Boolean);
  return parts.length ? `Issue synchronisiert · Kommentare: ${parts.join(" · ")}.` : "";
}

function githubSyncResourceKey(
  taskId: string,
  createIfMissing: boolean,
  repository: string,
  issueNumber: number | null,
) {
  if (issueNumber) return `github:${repository}#${issueNumber}`;
  return createIfMissing
    ? `task:${taskId}:${repository}:create-github-issue`
    : `task:${taskId}:${repository}:github-sync`;
}

async function loadTaskForSync(supabase: SupabaseClient, id: string): Promise<LoadedSyncTask> {
  const { data, error } = await supabase.from(ACTIVE_TASKS_TABLE).select("*").eq("id", id).single();
  if (error || !data) throw new Error(error?.message || "Aufgabe nicht gefunden.");

  const profileNameById = new Map<string, string>();
  const profileGitHubLoginById = new Map<string, string>();
  const involvedProfileIds = [data.assignee, data.owner]
    .filter((value): value is string => typeof value === "string" && Boolean(value));
  if (involvedProfileIds.length) {
    const profiles = await supabase
      .from("profiles")
      .select("id,name,github_login")
      .in("id", involvedProfileIds);
    if (profiles.error) throw new Error(profiles.error.message);
    for (const profile of (profiles.data || []) as SyncProfileRow[]) {
      profileNameById.set(profile.id, profile.name);
      if (profile.github_login) profileGitHubLoginById.set(profile.id, profile.github_login);
    }
  }

  const task = mapTaskRow(data as TaskRowForMapping, profileNameById);
  if (task.taskType === "sub_issue" && task.parentTaskId) {
    const parent = await supabase
      .from(ACTIVE_TASKS_TABLE)
      .select("approval_status")
      .eq("id", task.parentTaskId)
      .maybeSingle<{ approval_status: Task["parentApprovalStatus"] }>();
    if (parent.error) throw new Error(parent.error.message);
    task.parentApprovalStatus = parent.data?.approval_status || null;
  }
  const assigneeProfileId = data.assignee || "";
  const assigneeLogin = assigneeProfileId
    ? profileGitHubLoginById.get(assigneeProfileId) || ""
    : "";

  return {
    data: data as TaskRowForMapping & { owner?: string | null; assignee?: string | null },
    task,
    assigneeLogin,
  };
}

function validateTaskForProjection(loaded: LoadedSyncTask, createIfMissing: boolean) {
  const repository = resolveTaskGitHubRepository(loaded.task.taskType, loaded.task.githubRepo);
  if (!repository.ok) {
    return taskGitHubSyncFailure("github_sync_invalid_target", repository.error);
  }
  if (loaded.task.taskType === "deliverable" && loaded.task.approvalStatus !== "approved") {
    return taskGitHubSyncFailure(
      "github_sync_not_approved",
      "Nur freigegebene Deliverables können mit GitHub synchronisiert werden.",
    );
  }
  if (loaded.task.taskType === "sub_issue" && loaded.task.parentApprovalStatus !== "approved") {
    return taskGitHubSyncFailure(
      "github_sync_not_approved",
      "Das Parent-Deliverable muss vor dem GitHub-Sync freigegeben sein.",
    );
  }
  let issueNumber: number | null = null;
  try {
    issueNumber = resolveGitHubIssueNumber(loaded.task, {
      repository: repository.repository,
      requireConsistent: true,
    }) || null;
  } catch (error) {
    return taskGitHubSyncFailure(
      "github_sync_invalid_target",
      error instanceof Error
        ? error.message
        : "Die lokale GitHub-Issue-Verknüpfung ist ungültig.",
    );
  }
  if (!issueNumber && !createIfMissing) {
    return taskGitHubSyncFailure("github_sync_creation_required", creationRequiredMessage, {
      githubIssueSyncStatus: loaded.task.githubIssueSyncStatus,
      githubIssueSyncError: "",
    });
  }
  return {
    ok: true as const,
    repository: repository.repository,
    issueNumber,
  };
}

async function validateActiveTask(supabase: SupabaseClient, taskId: string) {
  const active = await requireActivePlanningItem(supabase, "tasks", taskId);
  if (active.ok) return null;
  if (active.status === 404) return taskGitHubSyncFailure("github_sync_not_found", active.error);
  if (active.status === 409) return taskGitHubSyncFailure("github_sync_inactive", active.error);
  return taskGitHubSyncFailure("github_sync_unavailable", active.error);
}

async function acquireGitHubSyncLock(
  supabase: SupabaseClient,
  resourceKey: string,
  taskId: string,
  actorProfileId: string,
) {
  const { data, error } = await supabase.rpc("try_acquire_github_issue_sync_lock", {
    p_resource_key: resourceKey,
    p_task_id: taskId,
    p_locked_by_profile_id: actorProfileId || null,
    p_ttl_seconds: 600,
  });
  if (error) throw new Error(`GitHub-Sync-Lock konnte nicht gesetzt werden: ${error.message}`);
  return typeof data === "string" && data ? data : null;
}

async function releaseGitHubSyncLock(
  supabase: SupabaseClient,
  resourceKey: string,
  lockToken: string,
) {
  const { data, error } = await supabase.rpc("release_github_issue_sync_lock", {
    p_resource_key: resourceKey,
    p_lock_token: lockToken,
  });
  if (error) {
    throw new Error(
      `GitHub-Sync-Lock konnte nicht freigegeben werden: ${error.message}`,
    );
  }
  if (data !== true) {
    throw new Error(
      "GitHub-Sync-Lock konnte nicht freigegeben werden: Die Freigabe wurde nicht bestätigt.",
    );
  }
}

export async function projectTaskToGitHub({
  supabase,
  installationToken,
  taskId,
  actorProfileId,
  createIfMissing,
}: {
  supabase: SupabaseClient;
  installationToken: string;
  taskId: string;
  actorProfileId: string;
  createIfMissing: boolean;
}): Promise<TaskGitHubProjectionResult> {
  const inactive = await validateActiveTask(supabase, taskId);
  if (inactive) return inactive;

  let loaded: LoadedSyncTask;
  try {
    loaded = await loadTaskForSync(supabase, taskId);
  } catch (error) {
    return taskGitHubSyncFailure(
      "github_sync_unavailable",
      error instanceof Error ? error.message : "Aufgabe konnte nicht geladen werden.",
    );
  }
  const eligibility = validateTaskForProjection(loaded, createIfMissing);
  if (!eligibility.ok) return eligibility;

  const resourceKey = githubSyncResourceKey(
    loaded.task.id,
    createIfMissing,
    eligibility.repository,
    eligibility.issueNumber,
  );
  let lockToken = "";
  try {
    lockToken = await acquireGitHubSyncLock(
      supabase,
      resourceKey,
      taskId,
      actorProfileId,
    ) || "";
  } catch (error) {
    return taskGitHubSyncFailure(
      "github_sync_unavailable",
      error instanceof Error ? error.message : "GitHub-Sync-Lock konnte nicht gesetzt werden.",
    );
  }
  if (!lockToken) {
    return taskGitHubSyncFailure(
      "github_sync_locked",
      "GitHub-Sync läuft bereits für diese Aufgabe oder dieses Issue.",
      {
        githubIssueSyncStatus: "pending",
        githubIssueSyncError: "GitHub-Sync läuft bereits.",
      },
    );
  }

  const runLockedTaskProjection = async (): Promise<TaskGitHubProjectionResult> => {
    const reloadedInactive = await validateActiveTask(supabase, taskId);
    if (reloadedInactive) return reloadedInactive;

    try {
      loaded = await loadTaskForSync(supabase, taskId);
    } catch (error) {
      return taskGitHubSyncFailure(
        "github_sync_unavailable",
        error instanceof Error ? error.message : "Aufgabe konnte nicht erneut geladen werden.",
      );
    }
    const reloadedEligibility = validateTaskForProjection(loaded, createIfMissing);
    if (!reloadedEligibility.ok) return reloadedEligibility;
    const { assigneeLogin, task } = loaded;
    const repository = reloadedEligibility.repository;
    if (githubSyncResourceKey(
      task.id,
      createIfMissing,
      repository,
      reloadedEligibility.issueNumber,
    ) !== resourceKey) {
      return taskGitHubSyncFailure("github_sync_stale", staleSyncMessage, {
        githubIssueSyncStatus: "not_synced",
        githubIssueSyncError: staleSyncMessage,
      });
    }

    let parentContext: GitHubSubIssueParentContext | null = null;
    if (task.taskType === "sub_issue") {
      parentContext = await preflightGitHubSubIssueParent(supabase, task, installationToken);
    }

    const { data: pendingTask, error: pendingError } = await supabase.rpc(
      "begin_github_issue_sync_transaction_v2",
      {
        p_task_id: taskId,
        p_expected_updated_at: task.updatedAt,
      },
    );
    if (pendingError?.code === "P0001") {
      return taskGitHubSyncFailure("github_sync_stale", staleSyncMessage, {
        githubIssueSyncStatus: "not_synced",
        githubIssueSyncError: staleSyncMessage,
      });
    }
    if (pendingError) {
      throw new Error(`GitHub-Sync konnte nicht gestartet werden: ${pendingError.message}`);
    }
    const pendingUpdatedAt = typeof pendingTask?.updated_at === "string"
      ? pendingTask.updated_at
      : "";
    if (!pendingUpdatedAt) {
      throw new Error("GitHub-Sync konnte nicht gestartet werden: Die neue Aufgabenrevision fehlt.");
    }

    const issue = await projectTaskGitHubIssue({
      task,
      token: installationToken,
      assigneeLogin,
    });
    if (task.taskType === "deliverable") {
      await projectTaskGitHubDependencies({
        supabase,
        taskId,
        currentIssueNumber: issue.number,
        repository,
        token: installationToken,
      });
    } else if (parentContext) {
      await connectGitHubSubIssue({
        parentRepository: parentContext.repository,
        parentIssueNumber: parentContext.issueNumber,
        childRepository: repository,
        childIssueNumber: issue.number,
        token: installationToken,
      });
    }

    const project = await projectTaskToFounderOpsGitHubProject({
      supabase,
      task,
      issueNumber: issue.number,
      repository,
      token: installationToken,
    });
    const warnings = [...issue.warnings, ...project.warnings];

    let linkedPullRequests: Task["linkedPullRequests"] | null = null;
    try {
      linkedPullRequests = await listGitHubIssueLinkedPullRequests(
        issue.number,
        installationToken,
        repository,
      );
    } catch (error) {
      warnings.push(
        `Verknüpfte Pull Requests konnten nicht aktualisiert werden: ${
          error instanceof Error ? error.message : "unbekannter Fehler"
        }`,
      );
    }

    const syncedAt = new Date().toISOString();
    const activityMessage = [
      `GitHub-Sync ausgeführt: ${repository}#${issue.number}`,
      issue.recovered ? "Vorhandenes FounderOps-Issue wiederverwendet" : "",
      issue.recreated ? "Gelöschtes GitHub Issue ersetzt" : "",
      ...warnings.map((warning) => `Warnung: ${warning}`),
    ].filter(Boolean).join(" · ");

    const { data: finalizedTask, error: finalizeError } = await supabase.rpc(
      "finalize_github_issue_sync_with_pull_requests_v1",
      {
        p_task_id: taskId,
        p_expected_updated_at: pendingUpdatedAt,
        p_github_repo: repository,
        p_github_issue_number: issue.number,
        p_github_issue_url: issue.url,
        p_synced_at: syncedAt,
        p_activity_message: activityMessage,
        p_linked_pull_requests: linkedPullRequests,
      },
    );
    if (finalizeError?.code === "P0001") {
      return taskGitHubSyncFailure("github_sync_stale", staleSyncMessage, {
        githubIssueSyncStatus: "not_synced",
        githubIssueSyncError: staleSyncMessage,
      });
    }
    if (finalizeError) {
      throw new Error(
        `GitHub Issue wurde gespeichert, aber die Verknüpfung ist fehlgeschlagen: ${finalizeError.message}`,
      );
    }

    const commentDelivery = await deliverPendingGitHubComments({
      supabase,
      taskId,
    }).catch(() => emptyCommentDelivery(1));
    const notice = commentDeliveryNotice(commentDelivery);
    return {
      ok: true,
      code: "github_sync_succeeded",
      issue: {
        repository,
        number: issue.number,
        url: issue.url,
        recovered: issue.recovered,
        recreated: issue.recreated,
      },
      task: {
        githubRepo: repository,
        githubIssueNumber: issue.number,
        githubIssueUrl: issue.url,
        githubIssueSyncStatus: "synced",
        githubIssueLastSyncedAt: syncedAt,
        githubIssueSyncError: "",
        updatedAt: finalizedTask?.updated_at || "",
        ...(linkedPullRequests === null ? {} : { linkedPullRequests }),
      },
      warnings,
      commentDelivery,
      notices: notice
        ? [{
            code: "github_comment_delivery_summary",
            level: "info",
            message: notice,
          }]
        : [],
    };
  };

  let projectionResult: TaskGitHubProjectionResult;
  try {
    projectionResult = await runLockedTaskProjection();
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub-Sync fehlgeschlagen.";
    const failurePersistence = await persistGitHubSyncFailure(supabase, {
      taskId,
      errorMessage: message,
      activityMessage: `GitHub-Sync fehlgeschlagen: ${message}`,
    });
    if (!failurePersistence.ok) {
      projectionResult = taskGitHubSyncFailure(
        "github_sync_state_persist_failed",
        githubSyncStatePersistFailedMessage,
      );
    } else {
      projectionResult = taskGitHubSyncFailure("github_sync_failed", message, {
        githubIssueSyncStatus: "failed",
        githubIssueSyncError: message,
        updatedAt: typeof failurePersistence.data?.updated_at === "string"
          ? failurePersistence.data.updated_at
          : "",
      });
    }
  }

  try {
    await releaseGitHubSyncLock(supabase, resourceKey, lockToken);
  } catch (error) {
    return taskGitHubSyncFailure(
      "github_sync_unavailable",
      error instanceof Error
        ? error.message
        : "GitHub-Sync-Lock konnte nicht freigegeben werden.",
      projectionResult.task,
    );
  }
  return projectionResult;
}
