import { after, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { isUuid } from "@/features/planning-items/model/planning-items-contract";
import { handlePlanningItemsRequest, planningItemsError, planningItemsJson } from "@/features/planning-items/model/planning-items-route";
import {
  buildPlanningItemCreatePreview,
  planningItemCreateGitHubSyncCommands,
  parsePlanningItemCreatePayload,
  planningItemCreateCommitItem,
  planningItemCreateHash,
  planningItemCreateRequiresOperationalLead,
} from "@/features/planning-items/model/planning-items-create";
import {
  executePlanningItemGitHubSyncs,
  preflightPlanningItemGitHubSync,
  type PlanningItemGitHubSyncTarget,
} from "@/features/planning-items/model/planning-items-github-sync";
import type {
  PlanningItemGitHubSyncCommand,
  PlanningItemGitHubSyncResult,
  TeamPlanningItemType,
} from "@/features/planning-items/model/planning-items-contract";

type CreateResponseItem = {
  itemType: TeamPlanningItemType;
  item: Record<string, unknown>;
  githubSync?: PlanningItemGitHubSyncResult;
};

type CreateTransactionResult = {
  batchId: string;
  replayed?: boolean;
  items: CreateResponseItem[];
};

function createSyncTargets(
  items: CreateResponseItem[],
  commands: Array<PlanningItemGitHubSyncCommand | null>,
) {
  return items.flatMap((entry, index): PlanningItemGitHubSyncTarget[] => {
    const command = commands[index];
    const itemId = String(entry.item?.id || "");
    return command && itemId
      ? [{ itemId, itemType: entry.itemType, command }]
      : [];
  });
}

function mergeCreateSyncResults(
  items: CreateResponseItem[],
  commands: Array<PlanningItemGitHubSyncCommand | null>,
  results: Map<string, PlanningItemGitHubSyncResult>,
) {
  return items.map((entry, index) => {
    if (!commands[index]) return entry;
    const result = results.get(String(entry.item?.id || ""));
    return result ? { ...entry, githubSync: result } : entry;
  });
}

async function persistCreateResponse(
  supabase: Parameters<typeof executePlanningItemGitHubSyncs>[0]["supabase"],
  tokenId: string,
  batchId: string,
  items: CreateResponseItem[],
) {
  const { error } = await supabase
    .from("team_task_intake_batches")
    .update({ response_tasks: items })
    .eq("id", batchId)
    .eq("token_id", tokenId);
  if (error) throw new Error(`GitHub-Sync-Ergebnis konnte nicht gespeichert werden: ${error.message}`);
}

export async function POST(request: NextRequest) {
  return handlePlanningItemsRequest(request, "write:planning-items:create", "Planning-Items-Erstellung konnte nicht gespeichert werden.", async (permission) => {
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() || "";
    if (!isUuid(idempotencyKey)) return planningItemsError("Gültiger UUID-Idempotency-Key ist erforderlich.", 400);
    const parsed = parsePlanningItemCreatePayload(await request.json().catch(() => null));
    if (!parsed.ok) return planningItemsError(parsed.error, 400);
    if (parsed.githubSyncMode
      && !permission.scopes.includes("write:planning-items:github-sync")) {
      return planningItemsError("Planning-API-Token hat nicht den erforderlichen GitHub-Sync-Scope.", 403);
    }
    if (planningItemCreateRequiresOperationalLead(parsed.items)
      && !["ceo", "deputy"].includes(permission.profile.platformRole)) {
      return planningItemsError("Nur CEO oder Deputy können Meilensteine anlegen.", 403);
    }
    const items = await buildPlanningItemCreatePreview(parsed.items, permission.profile, permission.supabase);
    if (items.some((item) => item.errors.length)) return planningItemsJson({ ok: false, error: "Planning-Items-Erstellung enthält ungültige Einträge.", items }, 400);
    const githubSyncCommands = planningItemCreateGitHubSyncCommands(parsed.items);
    const metadata = auditRequestMetadata(request);
    const { data, error } = await permission.supabase.rpc("create_team_planning_items_transaction", {
      p_token_id: permission.tokenId,
      p_profile_id: permission.profile.id,
      p_idempotency_key: idempotencyKey,
      p_request_hash: planningItemCreateHash(
        items,
        parsed.githubSyncMode,
        githubSyncCommands,
      ),
      p_items: items.map(planningItemCreateCommitItem),
      p_request_ip: metadata.request_ip,
      p_user_agent: metadata.user_agent || null,
    });
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    const transaction = data as CreateTransactionResult | null;
    if (!transaction?.batchId || !Array.isArray(transaction.items)) {
      throw new Error("Planning-Items-Erstellung lieferte kein vollständiges Ergebnis zurück.");
    }
    if (transaction.replayed || !parsed.githubSyncMode) {
      return planningItemsJson({ ok: true, ...transaction });
    }

    const targets = createSyncTargets(transaction.items, githubSyncCommands);
    if (parsed.githubSyncMode === "wait") {
      const results = await executePlanningItemGitHubSyncs({
        supabase: permission.supabase,
        actorProfileId: permission.profile.id,
        targets,
      });
      const responseItems = mergeCreateSyncResults(
        transaction.items,
        githubSyncCommands,
        results,
      );
      await persistCreateResponse(
        permission.supabase,
        permission.tokenId,
        transaction.batchId,
        responseItems,
      );
      return planningItemsJson({ ok: true, ...transaction, items: responseItems });
    }

    const preflightEntries = await Promise.all(targets.map(async (target) => [
      target.itemId,
      await preflightPlanningItemGitHubSync(
        permission.supabase,
        permission.profile.id,
        target,
      ),
    ] as const));
    const preflightResults = new Map(preflightEntries);
    const responseItems = mergeCreateSyncResults(
      transaction.items,
      githubSyncCommands,
      preflightResults,
    );
    await persistCreateResponse(
      permission.supabase,
      permission.tokenId,
      transaction.batchId,
      responseItems,
    );
    const acceptedTargets = targets.filter(
      (target) => preflightResults.get(target.itemId)?.status === "accepted",
    );
    if (acceptedTargets.length) {
      after(async () => {
        const results = await executePlanningItemGitHubSyncs({
          supabase: permission.supabase,
          actorProfileId: permission.profile.id,
          targets: acceptedTargets,
        });
        const finalItems = mergeCreateSyncResults(
          responseItems,
          githubSyncCommands,
          results,
        );
        try {
          await persistCreateResponse(
            permission.supabase,
            permission.tokenId,
            transaction.batchId,
            finalItems,
          );
        } catch {
          // The Task projection remains authoritative when response snapshot refresh fails.
        }
      });
    }
    return planningItemsJson({ ok: true, ...transaction, items: responseItems });
  });
}
