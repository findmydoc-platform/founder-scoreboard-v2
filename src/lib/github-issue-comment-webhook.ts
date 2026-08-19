import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { githubCommentMarkerId } from "@/features/tasks/model/github-comment-delivery-policy";
import { resolveGitHubCommentMentionSnapshot } from "@/lib/github-comment-mention-snapshot";
import { getGitHubAppInstallationToken } from "./github-app";
import { getGitHubIssueComment, isGitHubIssueApiUrl } from "./github";

type GitHubIssueCommentAction = "created" | "edited" | "deleted";

export type ClaimedGitHubIssueCommentDelivery = {
  deliveryId: string;
  action: GitHubIssueCommentAction;
  repositoryFullName: string;
  issueNumber: number;
  commentId: number;
  commentUpdatedAt: string;
  attempts: number;
};

export type GitHubIssueCommentSnapshot = {
  id: number;
  body: string;
  htmlUrl: string;
  issueUrl: string;
  createdAt: string;
  updatedAt: string;
  authorLogin: string;
  authorAvatarUrl: string | null;
};

type TaskMapping =
  | { kind: "found"; taskId: string }
  | { kind: "missing" }
  | { kind: "ambiguous" };

type ExternalCommentRow = {
  taskId: string;
  commentId: number;
  commentUpdatedAt: string;
  authorLogin: string;
  authorAvatarUrl: string | null;
  body: string;
  htmlUrl: string;
  createdAt: string;
  importedAt: string;
};

type ProjectionInput = {
  operation: "upsert" | "suppress" | "delete";
  taskId: string;
  commentUpdatedAt: string;
  comment?: ExternalCommentRow;
};

type FinalStatus = "processed" | "ignored" | "retry_scheduled" | "failed";

type FinalizeInput = {
  status: FinalStatus;
  statusReason: string;
  lastError?: string;
  availableAt?: string;
};

export type GitHubIssueCommentWebhookStore = {
  claim(deliveryId: string, lockToken: string): Promise<ClaimedGitHubIssueCommentDelivery | null>;
  resolveTask(repository: string, issueNumber: number): Promise<TaskMapping>;
  hasLocalComment(taskId: string, commentId: number): Promise<boolean>;
  applyProjection(
    deliveryId: string,
    lockToken: string,
    input: ProjectionInput,
  ): Promise<"applied" | "stale">;
  finalize(deliveryId: string, lockToken: string, input: FinalizeInput): Promise<boolean>;
};

export type GitHubIssueCommentWebhookResult =
  | { kind: "skipped" }
  | { kind: "processed"; reason: "comment_upserted" | "comment_removed" }
  | { kind: "ignored"; reason: "task_not_found" | "app_mirrored_comment" | "stale_comment_version" }
  | { kind: "retry_scheduled" | "failed"; reason: "projection_error" | "ambiguous_task_mapping" };

type CommentLoader = (
  delivery: ClaimedGitHubIssueCommentDelivery,
) => Promise<GitHubIssueCommentSnapshot>;

function positiveSafeInteger(value: unknown) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function claimedDelivery(value: unknown): ClaimedGitHubIssueCommentDelivery | null {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : null;
  if (!row) return null;
  const deliveryId = typeof row.delivery_id === "string" ? row.delivery_id.trim() : "";
  const action = row.action === "created" || row.action === "edited" || row.action === "deleted"
    ? row.action
    : null;
  const repositoryFullName = typeof row.repository_full_name === "string"
    ? row.repository_full_name.trim()
    : "";
  const issueNumber = positiveSafeInteger(row.issue_number);
  const commentId = positiveSafeInteger(row.comment_id);
  const commentUpdatedAt = typeof row.comment_updated_at === "string"
    ? row.comment_updated_at.trim()
    : "";
  const attempts = positiveSafeInteger(row.attempts);
  if (
    !deliveryId
    || !action
    || !repositoryFullName
    || !issueNumber
    || !commentId
    || !commentUpdatedAt
    || Number.isNaN(Date.parse(commentUpdatedAt))
    || !attempts
  ) {
    throw new Error("Claimed GitHub Issue comment delivery is invalid.");
  }
  return {
    deliveryId,
    action,
    repositoryFullName,
    issueNumber,
    commentId,
    commentUpdatedAt,
    attempts,
  };
}

export function createSupabaseGitHubIssueCommentWebhookStore(
  supabase: SupabaseClient,
): GitHubIssueCommentWebhookStore {
  return {
    async claim(deliveryId, lockToken) {
      const { data, error } = await supabase.rpc("claim_github_issue_comment_webhook_delivery", {
        p_delivery_id: deliveryId,
        p_lock_token: lockToken,
        p_lease_seconds: 120,
      });
      if (error) throw new Error(`GitHub Issue comment delivery could not be claimed: ${error.message}`);
      const row = Array.isArray(data) ? data[0] : data;
      return claimedDelivery(row);
    },

    async resolveTask(repository, issueNumber) {
      const { data, error } = await supabase.rpc("resolve_github_issue_comment_webhook_tasks", {
        p_repository_full_name: repository,
        p_issue_number: issueNumber,
      });
      if (error) throw new Error(`GitHub Issue task mapping could not be loaded: ${error.message}`);
      const rows = (data || []) as Array<{ task_id?: unknown }>;
      if (rows.length === 0) return { kind: "missing" };
      if (rows.length > 1) return { kind: "ambiguous" };
      const taskId = typeof rows[0]?.task_id === "string" ? rows[0].task_id.trim() : "";
      if (!taskId) throw new Error("GitHub Issue task mapping is invalid.");
      return { kind: "found", taskId };
    },

    async hasLocalComment(taskId, commentId) {
      const { data, error } = await supabase
        .from("task_comments")
        .select("id")
        .eq("task_id", taskId)
        .eq("id", commentId)
        .maybeSingle<{ id: number }>();
      if (error) throw new Error(`FounderOps comment marker could not be reconciled: ${error.message}`);
      return Boolean(data);
    },

    async applyProjection(deliveryId, lockToken, input) {
      const comment = input.comment;
      let actorProfileId = "";
      let mentionRecipientProfileIds: string[] = [];
      let baselineMentionRecipientProfileIds: string[] = [];
      let baselineSourceUpdatedAt: string | null = null;
      if (input.operation === "upsert" && comment) {
        const [{ data: profiles, error: profilesError }, { data: existingComment, error: existingCommentError }] = await Promise.all([
          supabase.from("profiles").select("id,name,github_login"),
          supabase
            .from("task_external_comments")
            .select("author_login,body,source_updated_at,mention_recipient_profile_ids,mention_recipients_initialized")
            .eq("source", "github")
            .eq("external_id", String(comment.commentId))
            .maybeSingle(),
        ]);
        if (profilesError) throw new Error(`GitHub mention profiles could not be loaded: ${profilesError.message}`);
        if (existingCommentError) throw new Error(`GitHub mention baseline could not be loaded: ${existingCommentError.message}`);
        const mentionSnapshot = resolveGitHubCommentMentionSnapshot({
          authorLogin: comment.authorLogin,
          body: comment.body,
          profiles: (profiles || []).map((profile) => ({
            id: profile.id,
            name: profile.name,
            githubLogin: profile.github_login,
          })),
          existing: existingComment ? {
            authorLogin: existingComment.author_login,
            body: existingComment.body,
            sourceUpdatedAt: existingComment.source_updated_at,
            mentionRecipientProfileIds: existingComment.mention_recipient_profile_ids || [],
            mentionRecipientsInitialized: existingComment.mention_recipients_initialized,
          } : undefined,
        });
        actorProfileId = mentionSnapshot.actorProfileId;
        mentionRecipientProfileIds = mentionSnapshot.mentionRecipientProfileIds;
        baselineMentionRecipientProfileIds = mentionSnapshot.baselineMentionRecipientProfileIds;
        baselineSourceUpdatedAt = mentionSnapshot.baselineSourceUpdatedAt;
      }
      const { data, error } = await supabase.rpc("apply_github_issue_comment_webhook_projection_with_mentions", {
        p_delivery_id: deliveryId,
        p_lock_token: lockToken,
        p_operation: input.operation,
        p_task_id: input.taskId,
        p_comment_updated_at: input.commentUpdatedAt,
        p_author_login: comment?.authorLogin || null,
        p_author_avatar_url: comment?.authorAvatarUrl || null,
        p_body: comment?.body || null,
        p_html_url: comment?.htmlUrl || null,
        p_created_at: comment?.createdAt || null,
        p_imported_at: comment?.importedAt || null,
        p_actor_profile_id: actorProfileId || null,
        p_mention_recipient_profile_ids: mentionRecipientProfileIds,
        p_baseline_mention_recipient_profile_ids: baselineMentionRecipientProfileIds,
        p_baseline_source_updated_at: baselineSourceUpdatedAt,
      });
      if (error) throw new Error(`GitHub Issue comment projection could not be applied: ${error.message}`);
      if (data !== "applied" && data !== "stale") {
        throw new Error("GitHub Issue comment projection returned an invalid result.");
      }
      return data;
    },

    async finalize(deliveryId, lockToken, input) {
      const { data, error } = await supabase.rpc("finalize_github_issue_comment_webhook_delivery", {
        p_delivery_id: deliveryId,
        p_lock_token: lockToken,
        p_status: input.status,
        p_status_reason: input.statusReason,
        p_last_error: input.lastError || null,
        p_available_at: input.availableAt || null,
      });
      if (error) throw new Error(`GitHub Issue comment delivery could not be finalized: ${error.message}`);
      return data === true;
    },
  };
}

async function loadCurrentGitHubIssueComment(
  delivery: ClaimedGitHubIssueCommentDelivery,
): Promise<GitHubIssueCommentSnapshot> {
  const token = await getGitHubAppInstallationToken();
  const comment = await getGitHubIssueComment(
    delivery.commentId,
    token,
    delivery.repositoryFullName,
  );
  return {
    id: comment.id,
    body: comment.body,
    htmlUrl: comment.html_url,
    issueUrl: comment.issue_url || "",
    createdAt: comment.created_at,
    updatedAt: comment.updated_at || "",
    authorLogin: comment.user?.login || "github-user",
    authorAvatarUrl: comment.user?.avatar_url || null,
  };
}

function commentBelongsToDelivery(
  comment: GitHubIssueCommentSnapshot,
  delivery: ClaimedGitHubIssueCommentDelivery,
) {
  if (comment.id !== delivery.commentId) return false;
  return isGitHubIssueApiUrl(
    comment.issueUrl,
    delivery.issueNumber,
    delivery.repositoryFullName,
  );
}

function normalizedComment(
  comment: GitHubIssueCommentSnapshot,
  delivery: ClaimedGitHubIssueCommentDelivery,
) {
  if (!commentBelongsToDelivery(comment, delivery)) {
    throw new Error("GitHub Issue comment identity does not match the verified delivery.");
  }
  const body = typeof comment.body === "string" ? comment.body.trim() : "";
  const authorLogin = typeof comment.authorLogin === "string" ? comment.authorLogin.trim() : "";
  const htmlUrl = typeof comment.htmlUrl === "string" ? comment.htmlUrl.trim() : "";
  const createdAt = typeof comment.createdAt === "string" ? comment.createdAt.trim() : "";
  const updatedAt = typeof comment.updatedAt === "string" ? comment.updatedAt.trim() : "";
  if (
    !body
    || !authorLogin
    || !htmlUrl
    || !createdAt
    || Number.isNaN(Date.parse(createdAt))
    || !updatedAt
    || Number.isNaN(Date.parse(updatedAt))
  ) {
    throw new Error("GitHub Issue comment payload is incomplete.");
  }
  return {
    body,
    authorLogin,
    htmlUrl,
    createdAt,
    updatedAt,
    authorAvatarUrl: typeof comment.authorAvatarUrl === "string" && comment.authorAvatarUrl.trim()
      ? comment.authorAvatarUrl.trim()
      : null,
  };
}

function retryAt(attempts: number) {
  const delaySeconds = Math.min(60 * 60, 60 * (2 ** Math.min(attempts, 6)));
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

async function finalizeOrThrow(
  store: GitHubIssueCommentWebhookStore,
  deliveryId: string,
  lockToken: string,
  input: FinalizeInput,
) {
  const finalized = await store.finalize(deliveryId, lockToken, input);
  if (!finalized) throw new Error("GitHub Issue comment delivery lock expired before finalization.");
}

export async function processGitHubIssueCommentWebhookDelivery({
  deliveryId,
  store,
  loadComment = loadCurrentGitHubIssueComment,
}: {
  deliveryId: string;
  store: GitHubIssueCommentWebhookStore;
  loadComment?: CommentLoader;
}): Promise<GitHubIssueCommentWebhookResult> {
  const lockToken = randomUUID();
  const delivery = await store.claim(deliveryId, lockToken);
  if (!delivery) return { kind: "skipped" };

  try {
    const task = await store.resolveTask(delivery.repositoryFullName, delivery.issueNumber);
    if (task.kind === "ambiguous") {
      await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
        status: "failed",
        statusReason: "ambiguous_task_mapping",
        lastError: "More than one FounderOps task references the GitHub Issue.",
      });
      return { kind: "failed", reason: "ambiguous_task_mapping" };
    }
    if (task.kind === "missing") {
      await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
        status: "ignored",
        statusReason: "task_not_found",
      });
      return { kind: "ignored", reason: "task_not_found" };
    }

    if (delivery.action === "deleted") {
      const projection = await store.applyProjection(delivery.deliveryId, lockToken, {
        operation: "delete",
        taskId: task.taskId,
        commentUpdatedAt: delivery.commentUpdatedAt,
      });
      if (projection === "stale") {
        await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
          status: "ignored",
          statusReason: "stale_comment_version",
        });
        return { kind: "ignored", reason: "stale_comment_version" };
      }
      await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
        status: "processed",
        statusReason: "comment_removed",
      });
      return { kind: "processed", reason: "comment_removed" };
    }

    const comment = await loadComment(delivery);
    const normalized = normalizedComment(comment, delivery);
    const markerId = githubCommentMarkerId(normalized.body);
    if (markerId && await store.hasLocalComment(task.taskId, markerId)) {
      const projection = await store.applyProjection(delivery.deliveryId, lockToken, {
        operation: "suppress",
        taskId: task.taskId,
        commentUpdatedAt: normalized.updatedAt,
      });
      if (projection === "stale") {
        await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
          status: "ignored",
          statusReason: "stale_comment_version",
        });
        return { kind: "ignored", reason: "stale_comment_version" };
      }
      await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
        status: "ignored",
        statusReason: "app_mirrored_comment",
      });
      return { kind: "ignored", reason: "app_mirrored_comment" };
    }

    const externalComment = {
      taskId: task.taskId,
      commentId: delivery.commentId,
      commentUpdatedAt: normalized.updatedAt,
      authorLogin: normalized.authorLogin,
      authorAvatarUrl: normalized.authorAvatarUrl,
      body: normalized.body,
      htmlUrl: normalized.htmlUrl,
      createdAt: normalized.createdAt,
      importedAt: new Date().toISOString(),
    };
    const projection = await store.applyProjection(delivery.deliveryId, lockToken, {
      operation: "upsert",
      taskId: task.taskId,
      commentUpdatedAt: normalized.updatedAt,
      comment: externalComment,
    });
    if (projection === "stale") {
      await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
        status: "ignored",
        statusReason: "stale_comment_version",
      });
      return { kind: "ignored", reason: "stale_comment_version" };
    }
    await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
      status: "processed",
      statusReason: "comment_upserted",
    });
    return { kind: "processed", reason: "comment_upserted" };
  } catch (error) {
    const message = error instanceof Error ? error.message : "GitHub Issue comment projection failed.";
    const terminal = delivery.attempts >= 5;
    await finalizeOrThrow(store, delivery.deliveryId, lockToken, {
      status: terminal ? "failed" : "retry_scheduled",
      statusReason: "projection_error",
      lastError: message,
      availableAt: terminal ? undefined : retryAt(delivery.attempts),
    });
    return { kind: terminal ? "failed" : "retry_scheduled", reason: "projection_error" };
  }
}
