import { auditRequestMetadata } from "@/lib/api-input";
import { after, type NextRequest } from "next/server";
import {
  isUuid,
  type PlanningItemGitHubSyncResult,
} from "@/features/planning-items/model/planning-items-contract";
import { actorContextFromPlanningTokenAuth } from "@/features/planning-items/model/planning-actor-context-server";
import {
  createEmptyEpicDeletePlanningItems,
  emptyEpicDeleteCommand,
  emptyEpicDeleteError,
  emptyEpicDeleteHash,
  emptyEpicDeleteTeamItem,
  parseEmptyEpicDeletePayload,
} from "@/features/planning-items/model/planning-items-empty-epic-delete";
import {
  buildPlanningItemUpdatePreview,
  mapLegacyPlanningItemDatabaseRow,
  mapPlanningItemDatabaseRow,
  parsePlanningItemPatchPayload,
  planningItemUpdateHash,
  type PlanningItemReplayType,
} from "@/features/planning-items/model/planning-item-update";
import {
  handlePlanningItemsRequest,
  planningItemsError,
  planningItemsJson,
} from "@/features/planning-items/model/planning-items-route";
import {
  executePlanningItemGitHubSyncs,
  preflightPlanningItemGitHubSync,
  type PlanningItemGitHubSyncTarget,
} from "@/features/planning-items/model/planning-items-github-sync";

type UpdateTransactionResult = {
  replayed?: boolean;
  itemType?: PlanningItemReplayType;
  item?: Record<string, unknown>;
  changedFields?: string[];
  systemEffects?: unknown[];
  githubSync?: PlanningItemGitHubSyncResult;
};

type StoredUpdateRequest = {
  request_hash: string;
  response: UpdateTransactionResult | null;
  contract_version: number | null;
};

type StoredDeleteRequest = {
  request_hash: string;
  response: DeleteTransactionResult | null;
  contract_version: number | null;
};

type DeleteTransactionResult = {
  replayed?: boolean;
  itemType?: "epic" | "milestone";
  item?: Record<string, unknown>;
  children?: { initiatives?: number; tasks?: number };
};

function itemLink(request: NextRequest, _itemType: PlanningItemReplayType, itemId: string) {
  return `${request.nextUrl.origin}/tasks/${encodeURIComponent(itemId)}`;
}

function updateResponse(
  request: NextRequest,
  fallbackItemId: string,
  transaction: UpdateTransactionResult,
  fallbackItemType: PlanningItemReplayType,
  fallbackChangedFields: string[] = [],
  fallbackSystemEffects: unknown[] = [],
  contractVersion = 2,
) {
  const itemType = transaction.itemType || fallbackItemType;
  const rawItem = transaction.item;
  if (!rawItem || !itemType) throw new Error("Planning-Items-Update lieferte kein Element zurück.");
  const item = contractVersion === 1 || itemType === "milestone"
    ? mapLegacyPlanningItemDatabaseRow(itemType, rawItem)
    : mapPlanningItemDatabaseRow(itemType, rawItem);
  return planningItemsJson({
    ok: true,
    replayed: Boolean(transaction.replayed),
    itemType,
    item,
    changedFields: transaction.changedFields || fallbackChangedFields,
    systemEffects: transaction.systemEffects || fallbackSystemEffects,
    ...(transaction.githubSync ? { githubSync: transaction.githubSync } : {}),
    itemLink: itemLink(request, itemType, String(item.id || fallbackItemId)),
  });
}

async function persistUpdateResponse(
  supabase: Parameters<typeof executePlanningItemGitHubSyncs>[0]["supabase"],
  tokenId: string,
  idempotencyKey: string,
  transaction: UpdateTransactionResult,
) {
  const { error } = await supabase
    .from("team_planning_item_update_requests")
    .update({ response: transaction })
    .eq("token_id", tokenId)
    .eq("idempotency_key", idempotencyKey);
  if (error) throw new Error(`GitHub-Sync-Ergebnis konnte nicht gespeichert werden: ${error.message}`);
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handlePlanningItemsRequest(request, "write:planning-items:update", "Planning-Items-Update konnte nicht gespeichert werden.", async (permission) => {
    const { id } = await context.params;
    const itemId = id.trim();
    if (!itemId) return planningItemsError("Planungselement-ID ist erforderlich.", 400);

    const idempotencyKey = request.headers.get("idempotency-key")?.trim() || "";
    if (!isUuid(idempotencyKey)) return planningItemsError("Gültiger UUID-Idempotency-Key ist erforderlich.", 400);

    const parsed = parsePlanningItemPatchPayload(await request.json().catch(() => null));
    if (!parsed.ok) return planningItemsError(parsed.error, 400);
    if (parsed.githubSyncMode
      && !permission.scopes.includes("write:planning-items:github-sync")) {
      return planningItemsError("Planning-API-Token hat nicht den erforderlichen GitHub-Sync-Scope.", 403);
    }

    const loadStoredRequest = () => permission.supabase
      .from("team_planning_item_update_requests")
      .select("request_hash,response,contract_version")
      .eq("token_id", permission.tokenId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    const storedResponse = (stored: StoredUpdateRequest) => {
      const itemType = stored.response?.itemType;
      if (!itemType) throw new Error("Gespeicherte Planning-Items-Wiederholung ist unvollständig.");
      if ((itemType === "epic" || itemType === "milestone") && !["ceo", "deputy"].includes(permission.profile.platformRole)) {
        return planningItemsError("Nur CEO oder Deputy können Epics bearbeiten.", 403);
      }
      const requestHash = planningItemUpdateHash({
        itemId,
        itemType,
        expectedUpdatedAt: parsed.expectedUpdatedAt,
        patch: parsed.raw,
      });
      if (requestHash !== stored.request_hash) {
        return planningItemsError("Idempotency-Key wurde mit anderen Daten wiederverwendet.", 409);
      }
      return updateResponse(
        request,
        itemId,
        { ...stored.response, replayed: true },
        itemType,
        [],
        [],
        Number(stored.contract_version || 1),
      );
    };
    const existingRequest = await loadStoredRequest();
    if (existingRequest.error) {
      throw Object.assign(new Error(existingRequest.error.message), { code: existingRequest.error.code });
    }
    if (existingRequest.data) {
      return storedResponse(existingRequest.data as StoredUpdateRequest);
    }

    const result = await buildPlanningItemUpdatePreview({
      actor: permission.profile,
      itemId,
      parsed,
      supabase: permission.supabase,
    });
    if (!result.ok) {
      if (result.status === 409) {
        const replayCheck = await loadStoredRequest();
        if (replayCheck.error) {
          throw Object.assign(new Error(replayCheck.error.message), { code: replayCheck.error.code });
        }
        if (replayCheck.data) return storedResponse(replayCheck.data as StoredUpdateRequest);
      }
      return planningItemsError(result.error, result.status);
    }
    const { preview } = result;
    if (preview.errors.length) {
      return planningItemsJson({
        ok: false,
        error: "Planning-Items-Update enthält ungültige Felder.",
        errors: preview.errors,
        warnings: preview.warnings,
      }, 400);
    }

    const metadata = auditRequestMetadata(request);
    const { data, error } = await permission.supabase.rpc("update_team_planning_item_transaction", {
      p_token_id: permission.tokenId,
      p_profile_id: permission.profile.id,
      p_item_type: preview.itemType,
      p_item_id: preview.itemId,
      p_expected_updated_at: preview.expectedUpdatedAt,
      p_idempotency_key: idempotencyKey,
      p_request_hash: planningItemUpdateHash({
        itemId: preview.itemId,
        itemType: preview.itemType,
        expectedUpdatedAt: preview.expectedUpdatedAt,
        patch: parsed.raw,
      }),
      p_patch: preview.dbPatch,
      p_changed_fields: preview.changedFields,
      p_system_effects: preview.systemEffects,
      p_request_ip: metadata.request_ip,
      p_user_agent: metadata.user_agent || null,
    });
    if (error) throw Object.assign(new Error(error.message), { code: error.code });

    const transaction = data as UpdateTransactionResult | null;
    if (!transaction) throw new Error("Planning-Items-Update lieferte kein Ergebnis zurück.");
    if (!parsed.githubSync || !parsed.githubSyncMode) {
      return updateResponse(request, itemId, transaction, preview.itemType, preview.changedFields, preview.systemEffects);
    }

    const target: PlanningItemGitHubSyncTarget = {
      itemId: preview.itemId,
      itemType: preview.itemType,
      command: parsed.githubSync,
    };
    if (parsed.githubSyncMode === "wait") {
      const results = await executePlanningItemGitHubSyncs({
        supabase: permission.supabase,
        actorProfileId: permission.profile.id,
        targets: [target],
      });
      const enriched = {
        ...transaction,
        githubSync: results.get(preview.itemId),
      };
      await persistUpdateResponse(
        permission.supabase,
        permission.tokenId,
        idempotencyKey,
        enriched,
      );
      return updateResponse(request, itemId, enriched, preview.itemType, preview.changedFields, preview.systemEffects);
    }

    const preflight = await preflightPlanningItemGitHubSync(
      permission.supabase,
      permission.profile.id,
      target,
    );
    const accepted = {
      ...transaction,
      githubSync: preflight,
    };
    await persistUpdateResponse(
      permission.supabase,
      permission.tokenId,
      idempotencyKey,
      accepted,
    );
    if (preflight.status === "accepted") {
      after(async () => {
        const results = await executePlanningItemGitHubSyncs({
          supabase: permission.supabase,
          actorProfileId: permission.profile.id,
          targets: [target],
        });
        const finalResult = results.get(preview.itemId);
        if (!finalResult) return;
        try {
          await persistUpdateResponse(
            permission.supabase,
            permission.tokenId,
            idempotencyKey,
            { ...transaction, githubSync: finalResult },
          );
        } catch {
          // The Task projection remains authoritative when response snapshot refresh fails.
        }
      });
    }
    return updateResponse(request, itemId, accepted, preview.itemType, preview.changedFields, preview.systemEffects);
  });
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handlePlanningItemsRequest(
    request,
    "write:planning-items:delete-empty",
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

      const requestHash = emptyEpicDeleteHash({ itemId, expectedUpdatedAt: parsed.expectedUpdatedAt });
      const legacyReplay = await permission.supabase
        .from("team_planning_milestone_delete_requests")
        .select("request_hash,response,contract_version")
        .eq("token_id", permission.tokenId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle();
      if (legacyReplay.error) throw Object.assign(new Error(legacyReplay.error.message), { code: legacyReplay.error.code });
      const stored = legacyReplay.data as StoredDeleteRequest | null;
      if (stored && Number(stored.contract_version || 1) === 1) {
        if (stored.request_hash !== requestHash) {
          return planningItemsError("Idempotency-Key wurde mit anderen Daten wiederverwendet.", 409);
        }
        const transaction = stored.response;
        if (!transaction?.item || transaction.itemType !== "milestone") {
          throw new Error("Gespeicherte Planning-Items-Wiederholung ist unvollständig.");
        }
        const item = mapLegacyPlanningItemDatabaseRow("milestone", transaction.item);
        return planningItemsJson({
          ok: true,
          replayed: true,
          itemType: "milestone",
          item,
          children: {
            initiatives: Number(transaction.children?.initiatives || 0),
            tasks: Number(transaction.children?.tasks || 0),
          },
          itemLink: itemLink(request, "milestone", String(item.id || itemId)),
        });
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
        const mapped = emptyEpicDeleteError(result.error);
        if (mapped.code && mapped.children) {
          return planningItemsJson({ ok: false, code: mapped.code, error: mapped.message, children: mapped.children }, mapped.status);
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
