import { after, type NextRequest } from "next/server";
import {
  parsePlanningItemGitHubSyncCommand,
  parsePlanningItemGitHubSyncMode,
  type PlanningItemGitHubSyncResult,
} from "@/features/planning-items/model/planning-items-contract";
import {
  executePlanningItemGitHubSyncs,
  loadPlanningItemGitHubSyncTarget,
  preflightPlanningItemGitHubSync,
} from "@/features/planning-items/model/planning-items-github-sync";
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
      const loaded = await loadPlanningItemGitHubSyncTarget(
        permission.supabase,
        itemId,
        command.command,
      );
      if (!loaded.ok) {
        return planningItemsJson({
          ok: false,
          itemId,
          githubSync: loaded.result,
        }, loaded.status);
      }

      if (mode === "wait") {
        const results = await executePlanningItemGitHubSyncs({
          supabase: permission.supabase,
          actorProfileId: permission.profile.id,
          targets: [loaded.target],
        });
        const result = results.get(itemId);
        if (!result) {
          return planningItemsError("GitHub-Sync lieferte kein Ergebnis.", 500);
        }
        return planningItemsJson({
          ok: result.status === "synced",
          itemId,
          itemType: loaded.target.itemType,
          githubSync: result,
        }, syncFailureStatus(result));
      }

      const preflight = await preflightPlanningItemGitHubSync(
        permission.supabase,
        permission.profile.id,
        loaded.target,
      );
      if (preflight.status !== "accepted") {
        return planningItemsJson({
          ok: false,
          itemId,
          itemType: loaded.target.itemType,
          githubSync: preflight,
        }, syncFailureStatus(preflight));
      }
      after(async () => {
        await executePlanningItemGitHubSyncs({
          supabase: permission.supabase,
          actorProfileId: permission.profile.id,
          targets: [loaded.target],
        });
      });
      return planningItemsJson({
        ok: true,
        itemId,
        itemType: loaded.target.itemType,
        githubSync: preflight,
      }, 202);
    },
  );
}
