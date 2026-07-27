import type { LinkedPullRequest } from "../types";

export type TaskGitHubSyncCommand = {
  createIfMissing: boolean;
};

export type TaskGitHubSyncErrorCode =
  | "github_sync_unauthenticated"
  | "github_sync_forbidden"
  | "github_sync_not_found"
  | "github_sync_inactive"
  | "github_sync_invalid_target"
  | "github_sync_not_approved"
  | "github_sync_creation_required"
  | "github_sync_locked"
  | "github_sync_stale"
  | "github_sync_failed"
  | "github_sync_unavailable"
  | "github_sync_state_persist_failed";

export type TaskGitHubSyncPatch = {
  githubRepo?: string;
  githubIssueNumber?: number | null;
  githubIssueUrl?: string;
  githubIssueSyncStatus?: "not_synced" | "pending" | "synced" | "failed";
  githubIssueLastSyncedAt?: string;
  githubIssueSyncError?: string;
  updatedAt?: string;
  linkedPullRequests?: LinkedPullRequest[];
};

export type GitHubCommentDeliverySummary = {
  delivered: number;
  reconciled: number;
  created: number;
  waitingForAuthorConnection: number;
  waitingForIssue: number;
  retryScheduled: number;
  failed: number;
};

export type GitHubSyncNotice = {
  code: string;
  level: "info" | "warning";
  message: string;
};

export type TaskGitHubProjectionSuccess = {
  ok: true;
  code: "github_sync_succeeded";
  issue: {
    repository: string;
    number: number;
    url: string;
    recovered: boolean;
    recreated: boolean;
  };
  task: TaskGitHubSyncPatch;
  warnings: string[];
  commentDelivery: GitHubCommentDeliverySummary;
  notices: GitHubSyncNotice[];
};

export type TaskGitHubProjectionFailure = {
  ok: false;
  code: TaskGitHubSyncErrorCode;
  error: string;
  retryable: boolean;
  task?: TaskGitHubSyncPatch;
};

export type TaskGitHubProjectionResult =
  | TaskGitHubProjectionSuccess
  | TaskGitHubProjectionFailure;

export function parseTaskGitHubSyncCommand(input: unknown): TaskGitHubSyncCommand | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const createIfMissing = (input as { createIfMissing?: unknown }).createIfMissing;
  return typeof createIfMissing === "boolean" ? { createIfMissing } : null;
}

const statusByErrorCode: Record<TaskGitHubSyncErrorCode, number> = {
  github_sync_unauthenticated: 401,
  github_sync_forbidden: 403,
  github_sync_not_found: 404,
  github_sync_inactive: 409,
  github_sync_invalid_target: 409,
  github_sync_not_approved: 409,
  github_sync_creation_required: 409,
  github_sync_locked: 409,
  github_sync_stale: 409,
  github_sync_failed: 502,
  github_sync_unavailable: 503,
  github_sync_state_persist_failed: 503,
};

const retryableCodes = new Set<TaskGitHubSyncErrorCode>([
  "github_sync_locked",
  "github_sync_stale",
  "github_sync_failed",
  "github_sync_unavailable",
  "github_sync_state_persist_failed",
]);

export function taskGitHubSyncHttpStatus(result: TaskGitHubProjectionResult) {
  return result.ok ? 200 : statusByErrorCode[result.code];
}

export function taskGitHubSyncFailure(
  code: TaskGitHubSyncErrorCode,
  error: string,
  task?: TaskGitHubSyncPatch,
): TaskGitHubProjectionFailure {
  return {
    ok: false,
    code,
    error,
    retryable: retryableCodes.has(code),
    ...(task ? { task } : {}),
  };
}

export type TaskGitHubSyncClientClassification =
  | { kind: "success"; result: TaskGitHubProjectionSuccess }
  | { kind: "locked"; result: TaskGitHubProjectionFailure; taskStatus: "pending" }
  | {
      kind: "retryable";
      result: TaskGitHubProjectionFailure;
      taskStatus: NonNullable<TaskGitHubSyncPatch["githubIssueSyncStatus"]>;
    }
  | { kind: "failure"; result: TaskGitHubProjectionFailure; taskStatus: "failed" };

export function classifyTaskGitHubSyncResponse(
  status: number,
  body: TaskGitHubProjectionResult | null,
): TaskGitHubSyncClientClassification {
  if (status >= 200 && status < 300 && body?.ok) {
    return { kind: "success", result: body };
  }

  const fallback = taskGitHubSyncFailure(
    status === 401
      ? "github_sync_unauthenticated"
      : status === 403
        ? "github_sync_forbidden"
        : status === 404
          ? "github_sync_not_found"
          : status === 409
            ? "github_sync_stale"
            : "github_sync_unavailable",
    body && !body.ok ? body.error : "GitHub-Sync konnte nicht ausgeführt werden.",
    body && !body.ok ? body.task : undefined,
  );
  const result = body && !body.ok ? body : fallback;
  if (result.code === "github_sync_locked") {
    return { kind: "locked", result, taskStatus: "pending" };
  }
  if (result.retryable) {
    const taskStatus = result.task?.githubIssueSyncStatus
      || (result.code === "github_sync_stale"
        || result.code === "github_sync_state_persist_failed"
        ? "not_synced"
        : "failed");
    return { kind: "retryable", result, taskStatus };
  }
  return { kind: "failure", result, taskStatus: "failed" };
}
