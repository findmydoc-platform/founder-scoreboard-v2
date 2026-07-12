import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findExistingGitHubComment, githubCommentMarker } from "@/features/tasks/model/github-comment-delivery-policy";
import { createGitHubIssueComment, GitHubApiError, listGitHubIssueComments } from "./github";
import { GitHubAppUserTokenRequiredError, getGitHubUserTokenForProfile } from "./github-app";
import type { AuthenticatedProfile, GitHubCommentDeliveryStatus, PlatformRole } from "./types";

type ClaimedDelivery = {
  task_comment_id: number;
  task_id: string;
  author_profile_id: string | null;
  github_issue_number: number | null;
  status: string;
  attempts: number;
};

type CommentRow = {
  id: number;
  task_id: string;
  profile_id: string | null;
  comment: string;
};

type TaskRow = {
  github_issue_number: number | null;
  issue_number: string | null;
};

type ProfileRow = {
  id: string;
  name: string;
  platform_role: PlatformRole;
  github_login: string | null;
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

const emptySummary = (): GitHubCommentDeliverySummary => ({
  delivered: 0,
  reconciled: 0,
  created: 0,
  waitingForAuthorConnection: 0,
  waitingForIssue: 0,
  retryScheduled: 0,
  failed: 0,
});

export type GitHubCommentDeliveryPreview = {
  existing: number;
  missing: number;
  waitingForAuthorConnection: number;
  waitingForIssue: number;
  failed: number;
};

function issueNumber(task: TaskRow, fallback: number | null) {
  if (task.github_issue_number && task.github_issue_number > 0) return task.github_issue_number;
  const legacy = Number(task.issue_number || 0);
  if (Number.isInteger(legacy) && legacy > 0) return legacy;
  return fallback && fallback > 0 ? fallback : null;
}

function authenticatedProfile(row: ProfileRow): AuthenticatedProfile {
  return {
    id: row.id,
    name: row.name,
    platformRole: row.platform_role,
    githubLogin: row.github_login || "",
  };
}

function retryAt(attempts: number) {
  const delaySeconds = Math.min(60 * 60, 60 * (2 ** Math.min(attempts, 6)));
  return new Date(Date.now() + delaySeconds * 1000).toISOString();
}

async function finalizeDelivery(
  supabase: SupabaseClient,
  lockToken: string,
  commentId: number,
  status: Exclude<GitHubCommentDeliveryStatus, "processing">,
  details: {
    statusReason?: string;
    issueNumber?: number;
    githubCommentId?: number;
    githubCommentUrl?: string;
    lastError?: string;
    nextAttemptAt?: string;
  } = {},
) {
  const { data, error } = await supabase.rpc("finalize_task_comment_github_delivery", {
    p_task_comment_id: commentId,
    p_lock_token: lockToken,
    p_status: status,
    p_status_reason: details.statusReason || null,
    p_github_issue_number: details.issueNumber || null,
    p_github_comment_id: details.githubCommentId || null,
    p_github_comment_url: details.githubCommentUrl || null,
    p_last_error: details.lastError || null,
    p_next_attempt_at: details.nextAttemptAt || null,
  });
  if (error) throw new Error(`GitHub-Kommentarstatus konnte nicht gespeichert werden: ${error.message}`);
  if (data !== true) throw new Error("GitHub-Kommentarstatus konnte wegen einer abgelaufenen Verarbeitungssperre nicht gespeichert werden.");
}

async function loadDeliveryContext(supabase: SupabaseClient, delivery: ClaimedDelivery) {
  const [commentResult, taskResult, profileResult] = await Promise.all([
    supabase.from("task_comments").select("id,task_id,profile_id,comment").eq("id", delivery.task_comment_id).maybeSingle<CommentRow>(),
    supabase.from("tasks").select("github_issue_number,issue_number").eq("id", delivery.task_id).maybeSingle<TaskRow>(),
    delivery.author_profile_id
      ? supabase.from("profiles").select("id,name,platform_role,github_login").eq("id", delivery.author_profile_id).maybeSingle<ProfileRow>()
      : Promise.resolve({ data: null, error: null }),
  ]);

  const error = commentResult.error || taskResult.error || profileResult.error;
  if (error) throw new Error(error.message);
  return {
    comment: commentResult.data,
    task: taskResult.data,
    profile: profileResult.data,
  };
}

export async function previewPendingGitHubComments(supabase: SupabaseClient, limit = 100) {
  const preview: GitHubCommentDeliveryPreview = {
    existing: 0,
    missing: 0,
    waitingForAuthorConnection: 0,
    waitingForIssue: 0,
    failed: 0,
  };
  const { data, error } = await supabase
    .from("task_comment_github_deliveries")
    .select("task_comment_id,task_id,author_profile_id,github_issue_number,status,attempts")
    .neq("status", "delivered")
    .order("created_at", { ascending: true })
    .limit(Math.max(1, Math.min(limit, 100)));
  if (error) throw new Error(`GitHub-Kommentarbestand konnte nicht gelesen werden: ${error.message}`);

  const commentsByAuthorAndIssue = new Map<string, Awaited<ReturnType<typeof listGitHubIssueComments>>>();
  for (const delivery of (data || []) as ClaimedDelivery[]) {
    try {
      const { comment, task, profile } = await loadDeliveryContext(supabase, delivery);
      if (!comment || !task) {
        preview.failed += 1;
        continue;
      }
      const targetIssueNumber = issueNumber(task, delivery.github_issue_number);
      if (!targetIssueNumber) {
        preview.waitingForIssue += 1;
        continue;
      }
      if (!profile?.github_login) {
        preview.waitingForAuthorConnection += 1;
        continue;
      }

      const cacheKey = `${profile.id}:${targetIssueNumber}`;
      let githubComments = commentsByAuthorAndIssue.get(cacheKey);
      if (!githubComments) {
        const authorToken = await getGitHubUserTokenForProfile(supabase, authenticatedProfile(profile));
        githubComments = await listGitHubIssueComments(targetIssueNumber, authorToken);
        commentsByAuthorAndIssue.set(cacheKey, githubComments);
      }
      const existing = findExistingGitHubComment(githubComments, {
        commentId: comment.id,
        authorLogin: profile.github_login,
        body: comment.comment,
      });
      if (existing) preview.existing += 1;
      else preview.missing += 1;
    } catch (previewError) {
      if (previewError instanceof GitHubAppUserTokenRequiredError
        || (previewError instanceof GitHubApiError && (previewError.status === 401 || previewError.status === 403))) {
        preview.waitingForAuthorConnection += 1;
      } else {
        preview.failed += 1;
      }
    }
  }
  return preview;
}

export async function deliverPendingGitHubComments({
  supabase,
  taskId,
  authorProfileId,
  limit = 20,
}: {
  supabase: SupabaseClient;
  taskId?: string;
  authorProfileId?: string;
  limit?: number;
}) {
  const summary = emptySummary();
  const lockToken = randomUUID();
  const { data, error } = await supabase.rpc("claim_task_comment_github_deliveries", {
    p_lock_token: lockToken,
    p_task_id: taskId || null,
    p_author_profile_id: authorProfileId || null,
    p_limit: limit,
    p_lease_seconds: 120,
  });
  if (error) throw new Error(`GitHub-Kommentarzustellungen konnten nicht reserviert werden: ${error.message}`);

  for (const delivery of (data || []) as ClaimedDelivery[]) {
    try {
      const { comment, task, profile } = await loadDeliveryContext(supabase, delivery);
      if (!comment || !task) {
        await finalizeDelivery(supabase, lockToken, delivery.task_comment_id, "failed", {
          statusReason: "source_record_missing",
          lastError: "Kommentar oder Aufgabe wurde nicht gefunden.",
        });
        summary.failed += 1;
        continue;
      }

      const targetIssueNumber = issueNumber(task, delivery.github_issue_number);
      if (!targetIssueNumber) {
        await finalizeDelivery(supabase, lockToken, comment.id, "waiting_for_issue", {
          statusReason: "github_issue_missing",
        });
        summary.waitingForIssue += 1;
        continue;
      }

      if (!profile?.github_login) {
        await finalizeDelivery(supabase, lockToken, comment.id, "waiting_for_author_connection", {
          statusReason: "author_connection_missing",
          issueNumber: targetIssueNumber,
        });
        summary.waitingForAuthorConnection += 1;
        continue;
      }

      let authorToken = "";
      try {
        authorToken = await getGitHubUserTokenForProfile(supabase, authenticatedProfile(profile));
      } catch (tokenError) {
        if (!(tokenError instanceof GitHubAppUserTokenRequiredError)) throw tokenError;
        await finalizeDelivery(supabase, lockToken, comment.id, "waiting_for_author_connection", {
          statusReason: "author_connection_required",
          issueNumber: targetIssueNumber,
        });
        summary.waitingForAuthorConnection += 1;
        continue;
      }

      const githubComments = await listGitHubIssueComments(targetIssueNumber, authorToken);
      const existing = findExistingGitHubComment(githubComments, {
        commentId: comment.id,
        authorLogin: profile.github_login,
        body: comment.comment,
      });

      if (existing) {
        await finalizeDelivery(supabase, lockToken, comment.id, "delivered", {
          statusReason: existing.reason,
          issueNumber: targetIssueNumber,
          githubCommentId: existing.comment.id,
          githubCommentUrl: existing.comment.html_url,
        });
        summary.delivered += 1;
        summary.reconciled += 1;
        continue;
      }

      const created = await createGitHubIssueComment(targetIssueNumber, comment.comment, authorToken, githubCommentMarker(comment.id));
      await finalizeDelivery(supabase, lockToken, comment.id, "delivered", {
        statusReason: "created",
        issueNumber: targetIssueNumber,
        githubCommentId: created.id,
        githubCommentUrl: created.html_url,
      });
      summary.delivered += 1;
      summary.created += 1;
    } catch (deliveryError) {
      if (deliveryError instanceof GitHubApiError && (deliveryError.status === 401 || deliveryError.status === 403)) {
        await finalizeDelivery(supabase, lockToken, delivery.task_comment_id, "waiting_for_author_connection", {
          statusReason: "author_connection_rejected",
          lastError: deliveryError.message,
        }).catch(() => undefined);
        summary.waitingForAuthorConnection += 1;
        continue;
      }
      const message = deliveryError instanceof Error ? deliveryError.message : "GitHub-Kommentar konnte nicht veröffentlicht werden.";
      const terminal = delivery.attempts >= 4;
      await finalizeDelivery(supabase, lockToken, delivery.task_comment_id, terminal ? "failed" : "retry_scheduled", {
        statusReason: terminal ? "delivery_failed" : "retry_after_error",
        lastError: message,
        nextAttemptAt: terminal ? undefined : retryAt(delivery.attempts),
      }).catch(() => undefined);
      if (terminal) summary.failed += 1;
      else summary.retryScheduled += 1;
    }
  }

  return summary;
}

export async function countWaitingGitHubCommentsForAuthor(supabase: SupabaseClient, profileId: string) {
  if (!profileId) return 0;
  const { count, error } = await supabase
    .from("task_comment_github_deliveries")
    .select("task_comment_id", { count: "exact", head: true })
    .eq("author_profile_id", profileId)
    .eq("status", "waiting_for_author_connection");
  if (error) throw new Error(`Wartende GitHub-Kommentare konnten nicht gelesen werden: ${error.message}`);
  return count || 0;
}
