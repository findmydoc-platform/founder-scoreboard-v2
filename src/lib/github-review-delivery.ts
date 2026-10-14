import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createGitHubIssueComment, GitHubApiError, listGitHubIssueComments } from "./github";
import { GitHubAppUserTokenRequiredError, getGitHubUserTokenForProfile } from "./github-app";
import { resolveGitHubIssueNumber } from "./github-issue-reference";
import { loadGitHubMentionTeam } from "./github-mention-team-config";
import { canonicalizeProfileMentionsForGitHub } from "./mentions";
import type { AuthenticatedProfile, GitHubCommentDeliveryStatus, PlatformRole } from "./types";

type ClaimedReviewDelivery = {
  task_review_id: number;
  task_id: string;
  author_profile_id: string | null;
  github_issue_number: number | null;
  status: string;
  attempts: number;
};

type ReviewRow = {
  id: number;
  task_id: string;
  reviewer_profile_id: string | null;
  decision: "accepted" | "partial" | "changes_requested";
  points: number;
  comment: string | null;
};

type TaskRow = { github_issue_number: number | null; issue_number: string | null; github_repo: string | null };
type ProfileRow = { id: string; name: string; platform_role: PlatformRole; github_login: string | null };

const decisionLabels = {
  accepted: "Angenommen",
  partial: "Kleine Nacharbeit",
  changes_requested: "Grundlegende Nacharbeit",
} as const;

function marker(reviewId: number) {
  return `fmd-review-id:${reviewId}`;
}

function authenticatedProfile(row: ProfileRow): AuthenticatedProfile {
  return { id: row.id, name: row.name, platformRole: row.platform_role, githubLogin: row.github_login || "" };
}

function retryAt(attempts: number) {
  const seconds = Math.min(3600, 60 * (2 ** Math.min(attempts, 6)));
  return new Date(Date.now() + seconds * 1000).toISOString();
}

async function finalize(
  supabase: SupabaseClient,
  lockToken: string,
  reviewId: number,
  status: Exclude<GitHubCommentDeliveryStatus, "processing">,
  details: { statusReason?: string; issueNumber?: number; githubCommentId?: number; githubCommentUrl?: string; lastError?: string; nextAttemptAt?: string } = {},
) {
  const { data, error } = await supabase.rpc("finalize_task_review_github_delivery", {
    p_task_review_id: reviewId,
    p_lock_token: lockToken,
    p_status: status,
    p_status_reason: details.statusReason || null,
    p_github_issue_number: details.issueNumber || null,
    p_github_comment_id: details.githubCommentId || null,
    p_github_comment_url: details.githubCommentUrl || null,
    p_last_error: details.lastError || null,
    p_next_attempt_at: details.nextAttemptAt || null,
  });
  if (error || data !== true) throw new Error(error?.message || "GitHub-Reviewstatus konnte nicht gespeichert werden.");
}

async function context(supabase: SupabaseClient, delivery: ClaimedReviewDelivery) {
  const [review, task, profile, profiles, team] = await Promise.all([
    supabase.from("task_reviews").select("id,task_id,reviewer_profile_id,decision,points,comment").eq("id", delivery.task_review_id).maybeSingle<ReviewRow>(),
    supabase.from("active_tasks").select("github_issue_number,issue_number,github_repo").eq("id", delivery.task_id).maybeSingle<TaskRow>(),
    delivery.author_profile_id
      ? supabase.from("profiles").select("id,name,platform_role,github_login").eq("id", delivery.author_profile_id).maybeSingle<ProfileRow>()
      : Promise.resolve({ data: null, error: null }),
    supabase.from("profiles").select("id,name,github_login"),
    loadGitHubMentionTeam(supabase),
  ]);
  const error = review.error || task.error || profile.error || profiles.error;
  if (error) throw new Error(error.message);
  return { review: review.data, task: task.data, profile: profile.data, profiles: profiles.data || [], team };
}

export async function deliverPendingGitHubReviews({ supabase, taskId, authorProfileId, limit = 20 }: {
  supabase: SupabaseClient;
  taskId?: string;
  authorProfileId?: string;
  limit?: number;
}) {
  const summary = { delivered: 0, waitingForAuthorConnection: 0, waitingForIssue: 0, retryScheduled: 0, failed: 0 };
  const lockToken = randomUUID();
  const { data, error } = await supabase.rpc("claim_task_review_github_deliveries", {
    p_lock_token: lockToken,
    p_task_id: taskId || null,
    p_author_profile_id: authorProfileId || null,
    p_limit: limit,
    p_lease_seconds: 120,
  });
  if (error) throw new Error(`GitHub-Reviewzustellungen konnten nicht reserviert werden: ${error.message}`);

  for (const delivery of (data || []) as ClaimedReviewDelivery[]) {
    try {
      const loaded = await context(supabase, delivery);
      if (!loaded.review || !loaded.task) {
        await finalize(supabase, lockToken, delivery.task_review_id, "failed", { statusReason: "source_record_missing", lastError: "Review oder Aufgabe wurde nicht gefunden." });
        summary.failed += 1;
        continue;
      }
      const issueNumber = resolveGitHubIssueNumber(loaded.task, { repository: loaded.task.github_repo, fallback: delivery.github_issue_number });
      if (!issueNumber) {
        await finalize(supabase, lockToken, loaded.review.id, "waiting_for_issue", { statusReason: "github_issue_missing" });
        summary.waitingForIssue += 1;
        continue;
      }
      if (!loaded.profile?.github_login) {
        await finalize(supabase, lockToken, loaded.review.id, "waiting_for_author_connection", { statusReason: "author_connection_missing", issueNumber });
        summary.waitingForAuthorConnection += 1;
        continue;
      }
      let token = "";
      try {
        token = await getGitHubUserTokenForProfile(supabase, authenticatedProfile(loaded.profile));
      } catch (tokenError) {
        if (!(tokenError instanceof GitHubAppUserTokenRequiredError)) throw tokenError;
        await finalize(supabase, lockToken, loaded.review.id, "waiting_for_author_connection", { statusReason: "author_connection_required", issueNumber });
        summary.waitingForAuthorConnection += 1;
        continue;
      }
      const githubComments = await listGitHubIssueComments(issueNumber, token, loaded.task.github_repo);
      const existing = githubComments.find((comment) => new RegExp(`<!--\\s*${marker(loaded.review!.id)}\\s*-->`).test(comment.body || ""));
      if (existing) {
        await finalize(supabase, lockToken, loaded.review.id, "delivered", { statusReason: "marker_reconciled", issueNumber, githubCommentId: existing.id, githubCommentUrl: existing.html_url });
        summary.delivered += 1;
        continue;
      }
      const comment = canonicalizeProfileMentionsForGitHub(
        loaded.review.comment || "",
        loaded.profiles.map((person) => ({ id: person.id, name: person.name, githubLogin: person.github_login })),
        loaded.team,
      );
      const body = [
        "## FounderOps Review",
        `**Entscheidung:** ${decisionLabels[loaded.review.decision]}`,
        `**Score:** ${loaded.review.points}/10`,
        comment,
      ].filter(Boolean).join("\n\n");
      const created = await createGitHubIssueComment(issueNumber, body, token, marker(loaded.review.id), loaded.task.github_repo);
      await finalize(supabase, lockToken, loaded.review.id, "delivered", { statusReason: "created", issueNumber, githubCommentId: created.id, githubCommentUrl: created.html_url });
      summary.delivered += 1;
    } catch (deliveryError) {
      if (deliveryError instanceof GitHubApiError && (deliveryError.status === 401 || deliveryError.status === 403)) {
        await finalize(supabase, lockToken, delivery.task_review_id, "waiting_for_author_connection", { statusReason: "author_connection_rejected", lastError: deliveryError.message }).catch(() => undefined);
        summary.waitingForAuthorConnection += 1;
        continue;
      }
      const terminal = delivery.attempts >= 4;
      const message = deliveryError instanceof Error ? deliveryError.message : "GitHub-Review konnte nicht veröffentlicht werden.";
      await finalize(supabase, lockToken, delivery.task_review_id, terminal ? "failed" : "retry_scheduled", {
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
