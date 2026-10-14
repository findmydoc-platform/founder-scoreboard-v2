import { auditRequestMetadata } from "@/lib/api-input";
import { after, type NextRequest } from "next/server";
import { isUuid } from "@/features/planning-items/model/planning-items-contract";
import { actorContextFromPlanningTokenAuth } from "@/features/planning-items/model/planning-actor-context-server";
import {
  createEmptyEpicDeletePlanningItems,
  emptyEpicDeleteCommand,
  emptyEpicDeleteError,
  emptyEpicDeleteTeamItem,
  parseEmptyEpicDeletePayload,
} from "@/features/planning-items/model/planning-items-empty-epic-delete";
import {
  mapPlanningItemDatabaseRow,
  parsePlanningItemPatchPayload,
  type PlanningItemReplayType,
} from "@/features/planning-items/model/planning-item-update";
import {
  handlePlanningItemsRequest,
  planningItemsError,
  planningItemsJson,
  planningItemsTokenInactiveError,
} from "@/features/planning-items/model/planning-items-route";
import {
  dispatchAndLoadPlanningGitHubProjections,
} from "@/features/planning-items/model/planning-items-github-projection";
import { hasCanonicalTeamPlanningItem } from "@/features/planning-items/model/planning-items-team-canonical-item";
import {
  commitTeamPlanningItemUpdate,
  type TeamPlanningItemUpdateTransaction,
} from "@/features/planning-items/model/planning-items-team-update";

type StoredDeleteRequest = {
  request_hash: string;
  response: DeleteTransactionResult | null;
  contract_version: number | null;
};

type DeleteTransactionResult = {
  replayed?: boolean;
  itemType?: "epic";
  item?: Record<string, unknown>;
  children?: { initiatives?: number; tasks?: number };
};

function itemLink(request: NextRequest, _itemType: PlanningItemReplayType, itemId: string) {
  return `${request.nextUrl.origin}/tasks/${encodeURIComponent(itemId)}`;
}

function updateResponse(
  request: NextRequest,
  fallbackItemId: string,
  transaction: TeamPlanningItemUpdateTransaction,
) {
  const itemType = transaction.itemType;
  const item = mapPlanningItemDatabaseRow(itemType, transaction.item);
  return planningItemsJson({
    ok: true,
    replayed: Boolean(transaction.replayed),
    itemType,
    item,
    changedFields: transaction.changedFields || [],
    systemEffects: transaction.systemEffects || [],
    ...(transaction.warnings ? { warnings: transaction.warnings } : {}),
    ...(transaction.dependencyChange ? { dependencyChange: transaction.dependencyChange } : {}),
    ...(transaction.githubSync ? { githubSync: transaction.githubSync } : {}),
    itemLink: itemLink(request, itemType, String(item.id || fallbackItemId)),
  });
}

export async function handleTeamPlanningItemUpdate(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  let parsed: ReturnType<typeof parsePlanningItemPatchPayload> | undefined;
  const parseRequest = async () => {
    parsed ??= parsePlanningItemPatchPayload(await request.json().catch(() => null));
    return parsed;
  };
  return handlePlanningItemsRequest(request, {
    operation: "planningItems.update",
    mode: "commit",
    requiredScopes: ["write:planning-items:update"],
    resolveAdditionalScopes: async () => {
      const payload = await parseRequest();
      return payload.ok && payload.githubSyncMode
        ? ["write:planning-items:github-sync"]
        : [];
    },
  }, "Planning-Items-Update konnte nicht gespeichert werden.", async (permission) => {
    const parsed = await parseRequest();
    const { id } = await context.params;
    const itemId = id.trim();
    if (!itemId) return planningItemsError("Planungselement-ID ist erforderlich.", 400);

    const idempotencyKey = request.headers.get("idempotency-key")?.trim() || "";
    if (!isUuid(idempotencyKey)) return planningItemsError("Gültiger UUID-Idempotency-Key ist erforderlich.", 400);
    if (!parsed.ok) return planningItemsError(parsed.error, 400);

    const actor = actorContextFromPlanningTokenAuth({
      ok: true,
      profile: { id: permission.profile.id, platformRole: permission.profile.platformRole },
      tokenId: permission.tokenId,
      scopes: permission.scopes,
    });
    if (!actor.ok) return planningItemsError("Planning-API-Berechtigung ist nicht mehr gültig.", 403);
    const metadata = auditRequestMetadata(request);
    const result = await commitTeamPlanningItemUpdate({
      actor: actor.actor,
      itemId,
      parsed,
      idempotencyKey,
      requestMetadata: { requestIp: metadata.request_ip || undefined, userAgent: metadata.user_agent || undefined },
    }, {
      supabase: permission.supabase,
      dispatchGitHubProjections: dispatchAndLoadPlanningGitHubProjections,
      scheduleAfter: after,
    });
    if (!result.ok) {
      if (result.code === "TOKEN_INACTIVE") return planningItemsTokenInactiveError();
      if (result.details) return planningItemsJson({ ok: false, error: result.error, ...result.details }, result.status);
      return planningItemsError(result.error, result.status, result.code ? { code: result.code } : undefined);
    }
    return updateResponse(request, itemId, result.transaction);
  });
}

export async function handleTeamPlanningItemDelete(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handlePlanningItemsRequest(
    request,
    {
      operation: "planningItems.deleteEmpty",
      mode: "commit",
      requiredScopes: ["write:planning-items:delete-empty"],
    },
    "Planning-Items-Löschung konnte nicht gespeichert werden.",
    async (permission) => {
      const { id } = await context.params;
      const itemId = id.trim();
      if (!itemId) return planningItemsError("Planungselement-ID ist erforderlich.", 400);
      if (!["ceo", "deputy"].includes(permission.profile.platformRole)) {
        return planningItemsError("Nur CEO oder Deputy können Epics löschen.", 403);
      }

      const idempotencyKey = request.headers.get("idempotency-key")?.trim() || "";
      if (!isUuid(idempotencyKey)) return planningItemsError("Gültiger UUID-Idempotency-Key ist erforderlich.", 400);

      const parsed = parseEmptyEpicDeletePayload(await request.json().catch(() => null));
      if (!parsed.ok) return planningItemsError(parsed.error, 400);

      const replay = await permission.supabase
        .from("team_planning_item_delete_requests")
        .select("request_hash,response,contract_version")
        .eq("token_id", permission.tokenId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (replay.error) throw Object.assign(new Error(replay.error.message), { code: replay.error.code });
      const stored = replay.data as StoredDeleteRequest | null;
      if (stored && Number(stored.contract_version || 1) < 2) {
        return planningItemsError("Idempotency-Key gehört zu einem älteren API-Vertrag.", 409);
      }
      if (!stored && !await hasCanonicalTeamPlanningItem(permission.supabase, itemId)) {
        return planningItemsError("Planungselement wurde nicht gefunden.", 404);
      }

      const actor = actorContextFromPlanningTokenAuth({
        ok: true,
        profile: {
          id: permission.profile.id,
          platformRole: permission.profile.platformRole,
        },
        tokenId: permission.tokenId,
        scopes: permission.scopes,
      });
      if (!actor.ok) return planningItemsError("Planning-API-Berechtigung ist nicht mehr gültig.", 403);
      const metadata = auditRequestMetadata(request);
      const result = await createEmptyEpicDeletePlanningItems(permission.supabase).run({
        actor: actor.actor,
        mode: "commit",
        command: emptyEpicDeleteCommand(itemId, parsed.expectedUpdatedAt),
        idempotencyKey,
        requestMetadata: {
          requestIp: metadata.request_ip || undefined,
          userAgent: metadata.user_agent || undefined,
        },
      });
      if (!result.ok) {
        if (result.error.code === "forbidden" && result.error.reason === "planningTokenInactive") {
          return planningItemsTokenInactiveError();
        }
        const mapped = emptyEpicDeleteError(result.error);
        if (mapped.code && mapped.children) {
          return planningItemsJson({ ok: false, code: "EPIC_NOT_EMPTY", error: mapped.message, children: mapped.children }, mapped.status);
        }
        if (result.error.code === "notFound") return planningItemsError("Planungselement wurde nicht gefunden.", 404);
        if (result.error.code === "conflict" && result.error.reason === "revision") {
          return planningItemsError("Planungselement wurde zwischenzeitlich geändert. Bitte erneut laden.", 409);
        }
        return planningItemsError(mapped.message, mapped.status);
      }
      if (result.status !== "committed") throw new Error("Planning-Items-Löschung wurde nicht bestätigt.");
      const projected = emptyEpicDeleteTeamItem(result);
      if (!projected) throw new Error("Planning-Items-Löschung lieferte kein Ergebnis zurück.");
      return planningItemsJson({
        ok: true,
        replayed: result.replayed,
        itemType: projected.itemType,
        item: projected.item,
        children: projected.children,
        itemLink: itemLink(request, projected.itemType, String(projected.item.id || itemId)),
      });
    },
  );
}
