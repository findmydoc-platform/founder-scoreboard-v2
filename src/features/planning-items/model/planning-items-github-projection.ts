import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  PlanningItemGitHubSyncCommand,
  PlanningItemGitHubSyncResult,
  TeamPlanningItemType,
} from "@/features/planning-items/model/planning-items-contract";
import { executePlanningItemGitHubSyncs } from "@/features/planning-items/model/planning-items-github-sync";

type ProjectionRequest = Readonly<{
  id: string;
  planning_operation_id: string;
  task_id: string;
  actor_profile_id: string;
  create_if_missing: boolean;
  status: "pending" | "processing" | "retry_scheduled" | "completed" | "failed";
  result: PlanningItemGitHubSyncResult | null;
}>;

export type PlanningGitHubProjectionDispatch = Readonly<{
  claimed: number;
  completed: number;
  retryScheduled: number;
  failed: number;
  results: ReadonlyMap<string, PlanningItemGitHubSyncResult>;
}>;

export type EnqueuedPlanningGitHubProjection = Readonly<{
  operationId: string;
  itemId: string;
  itemType: TeamPlanningItemType;
  githubSync: PlanningItemGitHubSyncResult;
  replayed: boolean;
}>;

const accepted: PlanningItemGitHubSyncResult = { status: "accepted" };

function failure(error: unknown): PlanningItemGitHubSyncResult {
  return {
    status: "failed",
    code: "github_sync_unavailable",
    error: error instanceof Error
      ? error.message
      : typeof error === "string" && error.trim()
        ? error
        : "GitHub-Sync konnte nicht verarbeitet werden.",
    retryable: true,
  };
}

async function finalize(
  supabase: SupabaseClient,
  request: ProjectionRequest,
  lockToken: string,
  result: PlanningItemGitHubSyncResult,
) {
  const succeeded = result.status !== "failed";
  const { data, error } = await supabase.rpc("finalize_planning_github_projection_request", {
    p_request_id: request.id,
    p_lock_token: lockToken,
    p_succeeded: succeeded,
    p_result: result,
    p_error_message: succeeded ? null : result.error,
  });
  if (error) throw new Error(`GitHub-Projektionsstatus konnte nicht gespeichert werden: ${error.message}`);
  return data as ProjectionRequest;
}

export async function dispatchPlanningGitHubProjections({
  supabase,
  operationId,
  limit = 25,
}: {
  supabase: SupabaseClient;
  operationId?: string;
  limit?: number;
}): Promise<PlanningGitHubProjectionDispatch> {
  const lockToken = randomUUID();
  const { data, error } = await supabase.rpc("claim_planning_github_projection_requests", {
    p_lock_token: lockToken,
    p_limit: Math.max(1, Math.min(limit, 100)),
    p_lease_seconds: 120,
    p_operation_id: operationId || null,
  });
  if (error) throw new Error(`GitHub-Projektionsaufträge konnten nicht reserviert werden: ${error.message}`);
  const requests = (data || []) as ProjectionRequest[];
  const results = new Map<string, PlanningItemGitHubSyncResult>();
  let completed = 0;
  let retryScheduled = 0;
  let failed = 0;

  if (requests.length) {
    for (const request of requests) {
      let result: PlanningItemGitHubSyncResult;
      try {
        const executed = await executePlanningItemGitHubSyncs({
          supabase,
          actorProfileId: request.actor_profile_id,
          targets: [{
            itemId: request.task_id,
            itemType: "deliverable",
            command: { createIfMissing: request.create_if_missing },
          }],
        });
        result = executed.get(request.task_id) || failure("GitHub-Sync lieferte kein Ergebnis.");
      } catch (executionError) {
        result = failure(executionError);
      }
      results.set(request.task_id, result);
      try {
        const finalized = await finalize(supabase, request, lockToken, result);
        if (finalized.status === "completed") completed += 1;
        else if (finalized.status === "retry_scheduled") retryScheduled += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
  }

  return { claimed: requests.length, completed, retryScheduled, failed, results };
}

export async function loadPlanningGitHubProjectionResults(
  supabase: SupabaseClient,
  operationId: string,
) {
  const { data, error } = await supabase
    .from("planning_github_projection_outbox")
    .select("task_id,result")
    .eq("planning_operation_id", operationId)
    .order("delivery_sequence", { ascending: true });
  if (error) throw new Error(`GitHub-Projektionsergebnisse konnten nicht geladen werden: ${error.message}`);
  return new Map((data || []).map((row: { task_id: string; result: PlanningItemGitHubSyncResult | null }) => [
    row.task_id,
    row.result || accepted,
  ]));
}

export async function dispatchAndLoadPlanningGitHubProjections(
  supabase: SupabaseClient,
  operationId: string,
) {
  await dispatchPlanningGitHubProjections({ supabase, operationId });
  return loadPlanningGitHubProjectionResults(supabase, operationId);
}

export async function enqueueTeamPlanningGitHubProjection({
  supabase,
  tokenId,
  actorProfileId,
  itemId,
  idempotencyKey,
  command,
}: {
  supabase: SupabaseClient;
  tokenId: string;
  actorProfileId: string;
  itemId: string;
  idempotencyKey: string;
  command: PlanningItemGitHubSyncCommand;
}) {
  const { data, error } = await supabase.rpc("enqueue_team_planning_github_projection_transaction", {
    p_token_id: tokenId,
    p_profile_id: actorProfileId,
    p_item_id: itemId,
    p_idempotency_key: idempotencyKey,
    p_create_if_missing: command.createIfMissing,
  });
  if (error) return { ok: false as const, error };
  return { ok: true as const, value: data as EnqueuedPlanningGitHubProjection };
}
