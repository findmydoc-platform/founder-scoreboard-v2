import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { getGitHubAppInstallationToken } from "@/lib/github-app";
import { persistGitHubSyncFailure } from "@/lib/github-sync-failure-persistence";
import {
  taskGitHubSyncFailure,
  taskGitHubSyncHttpStatus,
  type TaskGitHubProjectionFailure,
} from "@/lib/github-sync/contract";
import { projectTaskToGitHub } from "@/lib/github-sync/task-projection";
import { ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";
import {
  type PlanningItemGitHubSyncCommand,
  type PlanningItemGitHubSyncResult,
  type TeamPlanningItemType,
} from "@/features/planning-items/model/planning-items-contract";

export type PlanningItemGitHubSyncTarget = {
  itemId: string;
  itemType: TeamPlanningItemType;
  command: PlanningItemGitHubSyncCommand;
};

function failureResult(
  failure: TaskGitHubProjectionFailure,
): PlanningItemGitHubSyncResult {
  return {
    status: failure.retryable ? "failed" : "notEligible",
    code: failure.code,
    error: failure.error,
    retryable: failure.retryable,
  };
}

function invalidTypeResult(itemType: TeamPlanningItemType): PlanningItemGitHubSyncResult {
  return {
    status: "notEligible",
    code: "github_sync_invalid_target",
    error: itemType === "epic"
      ? "Epics können nicht mit GitHub synchronisiert werden."
      : "Initiativen können nicht mit GitHub synchronisiert werden.",
    retryable: false,
  };
}

export async function loadPlanningItemGitHubSyncTarget(
  supabase: SupabaseClient,
  itemId: string,
  command: PlanningItemGitHubSyncCommand,
): Promise<
  | { ok: true; target: PlanningItemGitHubSyncTarget }
  | { ok: false; result: PlanningItemGitHubSyncResult; status: number }
> {
  const task = await supabase
    .from(ACTIVE_TASKS_TABLE)
    .select("id,task_type")
    .eq("id", itemId)
    .maybeSingle();
  if (task.error) {
    const failure = taskGitHubSyncFailure(
      "github_sync_unavailable",
      "Planungselement konnte nicht geladen werden.",
    );
    return { ok: false, result: failureResult(failure), status: taskGitHubSyncHttpStatus(failure) };
  }
  if (task.data) {
    const itemType = task.data.task_type as TeamPlanningItemType;
    if (itemType === "epic" || itemType === "initiative") {
      return { ok: false, result: invalidTypeResult(itemType), status: 409 };
    }
    return {
      ok: true,
      target: {
        itemId,
        itemType,
        command,
      },
    };
  }

  const failure = taskGitHubSyncFailure(
    "github_sync_not_found",
    "Planungselement wurde nicht gefunden oder ist im Papierkorb.",
  );
  return { ok: false, result: failureResult(failure), status: taskGitHubSyncHttpStatus(failure) };
}

export async function preflightPlanningItemGitHubSync(
  supabase: SupabaseClient,
  actorProfileId: string,
  target: PlanningItemGitHubSyncTarget,
): Promise<PlanningItemGitHubSyncResult> {
  if (target.itemType === "epic" || target.itemType === "initiative") {
    return invalidTypeResult(target.itemType);
  }
  const result = await projectTaskToGitHub({
    supabase,
    taskId: target.itemId,
    actorProfileId,
    createIfMissing: target.command.createIfMissing,
    preflightOnly: true,
  });
  return result.ok ? { status: "accepted" } : failureResult(result);
}

async function persistInfrastructureFailure(
  supabase: SupabaseClient,
  target: PlanningItemGitHubSyncTarget,
  error: string,
): Promise<PlanningItemGitHubSyncResult> {
  const persisted = await persistGitHubSyncFailure(supabase, {
    taskId: target.itemId,
    errorMessage: error,
    activityMessage: `GitHub-Sync fehlgeschlagen: ${error}`,
  });
  if (!persisted.ok) {
    return {
      status: "failed",
      code: "github_sync_state_persist_failed",
      error: "GitHub-Sync ist fehlgeschlagen, aber der Status konnte nicht sicher gespeichert werden.",
      retryable: true,
    };
  }
  return {
    status: "failed",
    code: "github_sync_unavailable",
    error,
    retryable: true,
  };
}

export async function executePlanningItemGitHubSyncs({
  supabase,
  actorProfileId,
  targets,
}: {
  supabase: SupabaseClient;
  actorProfileId: string;
  targets: PlanningItemGitHubSyncTarget[];
}) {
  const results = new Map<string, PlanningItemGitHubSyncResult>();
  const executable: PlanningItemGitHubSyncTarget[] = [];
  for (const target of targets) {
    if (target.itemType === "epic" || target.itemType === "initiative") {
      results.set(target.itemId, invalidTypeResult(target.itemType));
      continue;
    }
    const preflight = await preflightPlanningItemGitHubSync(
      supabase,
      actorProfileId,
      target,
    );
    if (preflight.status === "accepted") {
      executable.push(target);
    } else {
      results.set(target.itemId, preflight);
    }
  }
  if (!executable.length) return results;

  let installationToken = "";
  try {
    installationToken = await getGitHubAppInstallationToken();
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "GitHub-Verbindung konnte nicht geprüft werden.";
    for (const target of executable) {
      results.set(
        target.itemId,
        await persistInfrastructureFailure(supabase, target, message),
      );
    }
    return results;
  }

  // GitHub mutations remain serial across tasks. The requested maximum
  // concurrency is therefore conservatively satisfied with one worker.
  for (const target of executable) {
    const result = await projectTaskToGitHub({
      supabase,
      installationToken,
      taskId: target.itemId,
      actorProfileId,
      createIfMissing: target.command.createIfMissing,
    });
    results.set(target.itemId, result.ok
      ? {
        status: "synced",
        code: result.code,
        issue: result.issue,
        warnings: result.warnings,
      }
      : failureResult(result));
  }
  return results;
}
