import { randomUUID } from "node:crypto";
import { after, type NextRequest } from "next/server";
import {
  parsePlanningItemGitHubSyncCommand,
  parsePlanningItemGitHubSyncMode,
  isUuid,
  type PlanningItemGitHubSyncResult,
} from "@/features/planning-items/model/planning-items-contract";
import {
  dispatchAndLoadPlanningGitHubProjections,
  enqueueTeamPlanningGitHubProjection,
} from "@/features/planning-items/model/planning-items-github-projection";
import {
  handlePlanningItemsRequest,
  planningItemsError,
  planningItemsJson,
} from "@/features/planning-items/model/planning-items-route";
import {
  taskGitHubSyncFailure,
  taskGitHubSyncHttpStatus,
  type TaskGitHubSyncErrorCode,
} from "@/lib/github-sync/contract";

function syncFailureStatus(result: PlanningItemGitHubSyncResult) {
  if (result.status === "accepted") return 202;
  if (result.status === "synced") return 200;
  return taskGitHubSyncHttpStatus(taskGitHubSyncFailure(
    result.code as TaskGitHubSyncErrorCode,
    result.error,
  ));
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handlePlanningItemsRequest(
    request,
    "write:planning-items:github-sync",
    "GitHub-Sync konnte nicht ausgeführt werden.",
    async (permission) => {
      const payload = await request.json().catch(() => null);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        return planningItemsError("GitHub-Sync-Payload muss ein Objekt sein.", 400);
      }
      const unknownField = Object.keys(payload).find(
        (key) => !["githubSyncMode", "createIfMissing"].includes(key),
      );
      if (unknownField) {
        return planningItemsError(`GitHub-Sync-Payload enthält das unbekannte Feld ${unknownField}.`, 400);
      }
      const mode = parsePlanningItemGitHubSyncMode(
        (payload as { githubSyncMode?: unknown }).githubSyncMode,
      );
      if (!mode) {
        return planningItemsError("githubSyncMode muss async oder wait sein.", 400);
      }
      const command = parsePlanningItemGitHubSyncCommand({
        createIfMissing: (payload as { createIfMissing?: unknown }).createIfMissing,
      });
      if (!command.ok) return planningItemsError(command.error, 400);

      const { id } = await context.params;
      const itemId = id.trim();
      if (!itemId) return planningItemsError("Planungselement-ID ist erforderlich.", 400);
      const requestedIdempotencyKey = request.headers?.get?.("idempotency-key")?.trim() || "";
      const idempotencyKey = isUuid(requestedIdempotencyKey) ? requestedIdempotencyKey : randomUUID();
      const enqueued = await enqueueTeamPlanningGitHubProjection({
        supabase: permission.supabase,
        tokenId: permission.tokenId,
        actorProfileId: permission.profile.id,
        itemId,
        idempotencyKey,
        command: command.command,
      });
      if (!enqueued.ok) {
        const code = String((enqueued.error as { code?: unknown }).code || "");
        if (code === "P0003") {
          return planningItemsError("Idempotency-Key wurde mit anderen Daten wiederverwendet.", 409);
        }
        const result: PlanningItemGitHubSyncResult = code === "P0014" || code === "P0015"
          ? {
              status: "notEligible",
              code: code === "P0015" ? "github_sync_creation_required" : "github_sync_not_approved",
              error: String((enqueued.error as { message?: unknown }).message || "GitHub-Sync ist nicht möglich."),
              retryable: false,
            }
          : {
              status: "failed",
              code: code === "P0002" ? "github_sync_not_found" : "github_sync_unavailable",
              error: code === "P0002" ? "Planungselement wurde nicht gefunden oder ist im Papierkorb." : "GitHub-Sync konnte nicht dauerhaft angenommen werden.",
              retryable: code !== "P0002",
            };
        return planningItemsJson({
          ok: false,
          itemId,
          githubSync: result,
        }, syncFailureStatus(result));
      }

      if (mode === "wait") {
        const results = await dispatchAndLoadPlanningGitHubProjections(permission.supabase, enqueued.value.operationId);
        const result = results.get(itemId);
        if (!result) {
          return planningItemsError("GitHub-Sync lieferte kein Ergebnis.", 500);
        }
        return planningItemsJson({
          ok: result.status === "synced",
          itemId,
          itemType: enqueued.value.itemType,
          githubSync: result,
        }, syncFailureStatus(result));
      }

      after(async () => {
        await dispatchAndLoadPlanningGitHubProjections(permission.supabase, enqueued.value.operationId);
      });
      return planningItemsJson({
        ok: true,
        itemId,
        itemType: enqueued.value.itemType,
        githubSync: enqueued.value.githubSync,
      }, 202);
    },
  );
}
