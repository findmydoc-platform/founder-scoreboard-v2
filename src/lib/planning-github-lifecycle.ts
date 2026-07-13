import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getGitHubAppInstallationToken } from "./github-app";
import { closeGitHubIssueNotPlanned, reopenGitHubIssueForPlanning } from "./planning-github-lifecycle-github";

export type PlanningGitHubLifecycleJob = {
  id: string;
  root_type: "initiative" | "deliverable";
  root_id: string;
  root_trash_revision: number;
  task_id: string;
  github_repo: string | null;
  github_issue_number: number | null;
  action: "close_not_planned" | "reopen";
  source_type: "withdrawn" | "rejected" | "approval";
  source_revision: number;
  reason: string | null;
  status: "pending" | "processing" | "retry_scheduled" | "completed" | "failed";
  status_reason: string | null;
  attempts: number;
};

export type PlanningGitHubLifecycleSummary = {
  claimed: number;
  completed: number;
  retryScheduled: number;
  failed: number;
  errors: Array<{ jobId: string; message: string }>;
};

function closeComment(job: PlanningGitHubLifecycleJob) {
  const reason = job.reason?.trim();
  return [
    "FounderOps: Dieses Planungselement wurde in den Papierkorb verschoben.",
    reason ? `Begründung: ${reason}` : "",
  ].filter(Boolean).join("\n\n");
}

function reopenComment() {
  return "FounderOps: Das zugehörige Deliverable wurde erneut freigegeben. Dieses Issue ist wieder offen.";
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "GitHub-Lifecycle konnte nicht verarbeitet werden.";
}

async function finalizeJob(
  supabase: SupabaseClient,
  jobId: string,
  lockToken: string,
  succeeded: boolean,
  details: { error?: string; statusReason?: string } = {},
) {
  const { data, error: rpcError } = await supabase.rpc("finalize_planning_github_lifecycle_job", {
    p_job_id: jobId,
    p_lock_token: lockToken,
    p_succeeded: succeeded,
    p_error_message: details.error || null,
    p_status_reason: details.statusReason || null,
  });
  if (rpcError) throw new Error(`GitHub-Lifecycle-Status konnte nicht gespeichert werden: ${rpcError.message}`);
  return data as PlanningGitHubLifecycleJob;
}

async function processJob(job: PlanningGitHubLifecycleJob, token: string) {
  if (!job.github_issue_number || !job.github_repo) {
    throw new Error("GitHub Issue-Verknüpfung fehlt.");
  }
  if (job.action === "close_not_planned") {
    return closeGitHubIssueNotPlanned({
      issueNumber: job.github_issue_number,
      taskId: job.task_id,
      sourceRevision: job.source_revision,
      comment: closeComment(job),
      token,
      repository: job.github_repo,
    });
  }
  return reopenGitHubIssueForPlanning({
    issueNumber: job.github_issue_number,
    taskId: job.task_id,
    sourceRevision: job.source_revision,
    comment: reopenComment(),
    token,
    repository: job.github_repo,
  });
}

export async function drainPlanningGitHubLifecycleJobs({
  supabase,
  limit = 25,
  githubToken,
}: {
  supabase: SupabaseClient;
  limit?: number;
  githubToken?: string;
}): Promise<PlanningGitHubLifecycleSummary> {
  const summary: PlanningGitHubLifecycleSummary = {
    claimed: 0,
    completed: 0,
    retryScheduled: 0,
    failed: 0,
    errors: [],
  };
  const lockToken = randomUUID();
  const { data, error } = await supabase.rpc("claim_planning_github_lifecycle_jobs", {
    p_lock_token: lockToken,
    p_limit: Math.max(1, Math.min(limit, 100)),
    p_lease_seconds: 120,
  });
  if (error) throw new Error(`GitHub-Lifecycle-Jobs konnten nicht reserviert werden: ${error.message}`);

  const jobs = (data || []) as PlanningGitHubLifecycleJob[];
  summary.claimed = jobs.length;
  if (!jobs.length) return summary;

  const deliverableJobs: PlanningGitHubLifecycleJob[] = [];
  for (const job of jobs) {
    if (job.github_issue_number && job.github_repo) {
      deliverableJobs.push(job);
      continue;
    }
    try {
      await finalizeJob(supabase, job.id, lockToken, true, { statusReason: "issue_missing" });
      summary.completed += 1;
    } catch (finalizeError) {
      summary.failed += 1;
      summary.errors.push({ jobId: job.id, message: errorMessage(finalizeError) });
    }
  }
  if (!deliverableJobs.length) return summary;

  let token = githubToken?.trim() || "";
  if (!token) {
    try {
      token = await getGitHubAppInstallationToken();
    } catch (tokenError) {
      const message = errorMessage(tokenError);
      for (const job of deliverableJobs) {
        try {
          const finalized = await finalizeJob(supabase, job.id, lockToken, false, { error: message });
          if (finalized.status === "failed") summary.failed += 1;
          else summary.retryScheduled += 1;
        } catch (finalizeError) {
          summary.failed += 1;
          summary.errors.push({ jobId: job.id, message: errorMessage(finalizeError) });
        }
      }
      return summary;
    }
  }

  for (const job of deliverableJobs) {
    try {
      await processJob(job, token);
      await finalizeJob(supabase, job.id, lockToken, true, { statusReason: "delivered" });
      summary.completed += 1;
    } catch (jobError) {
      const message = errorMessage(jobError);
      try {
        const finalized = await finalizeJob(supabase, job.id, lockToken, false, { error: message });
        if (finalized.status === "failed") summary.failed += 1;
        else summary.retryScheduled += 1;
      } catch (finalizeError) {
        summary.failed += 1;
        summary.errors.push({ jobId: job.id, message: errorMessage(finalizeError) });
      }
    }
  }

  return summary;
}
