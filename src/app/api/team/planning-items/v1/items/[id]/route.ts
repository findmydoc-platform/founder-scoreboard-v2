import { auditRequestMetadata } from "@/lib/api-input";
import type { NextRequest } from "next/server";
import { isUuid } from "@/features/planning-items/model/planning-items-contract";
import {
  buildPlanningItemUpdatePreview,
  mapPlanningItemDatabaseRow,
  parsePlanningItemPatchPayload,
  planningItemUpdateHash,
} from "@/features/planning-items/model/planning-item-update";
import {
  handlePlanningItemsRequest,
  planningItemsError,
  planningItemsJson,
} from "@/features/planning-items/model/planning-items-route";

type UpdateTransactionResult = {
  replayed?: boolean;
  itemType?: "initiative" | "deliverable" | "sub_issue";
  item?: Record<string, unknown>;
  changedFields?: string[];
  systemEffects?: unknown[];
};

type StoredUpdateRequest = {
  request_hash: string;
  response: UpdateTransactionResult | null;
};

function itemLink(request: NextRequest, itemType: "initiative" | "deliverable" | "sub_issue", itemId: string) {
  if (itemType === "initiative") return `${request.nextUrl.origin}/?workspace=projects`;
  return `${request.nextUrl.origin}/tasks/${encodeURIComponent(itemId)}`;
}

function updateResponse(
  request: NextRequest,
  fallbackItemId: string,
  transaction: UpdateTransactionResult,
  fallbackItemType: "initiative" | "deliverable" | "sub_issue",
  fallbackChangedFields: string[] = [],
  fallbackSystemEffects: unknown[] = [],
) {
  const itemType = transaction.itemType || fallbackItemType;
  const rawItem = transaction.item;
  if (!rawItem || !itemType) throw new Error("Planning-Items-Update lieferte kein Element zurück.");
  const item = mapPlanningItemDatabaseRow(itemType, rawItem);
  return planningItemsJson({
    ok: true,
    replayed: Boolean(transaction.replayed),
    itemType,
    item,
    changedFields: transaction.changedFields || fallbackChangedFields,
    systemEffects: transaction.systemEffects || fallbackSystemEffects,
    itemLink: itemLink(request, itemType, String(item.id || fallbackItemId)),
  });
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

    const loadStoredRequest = () => permission.supabase
      .from("team_planning_item_update_requests")
      .select("request_hash,response")
      .eq("token_id", permission.tokenId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    const storedResponse = (stored: StoredUpdateRequest) => {
      const itemType = stored.response?.itemType;
      if (!itemType) throw new Error("Gespeicherte Planning-Items-Wiederholung ist unvollständig.");
      const requestHash = planningItemUpdateHash({
        itemId,
        itemType,
        expectedUpdatedAt: parsed.expectedUpdatedAt,
        patch: parsed.raw,
      });
      if (requestHash !== stored.request_hash) {
        return planningItemsError("Idempotency-Key wurde mit anderen Daten wiederverwendet.", 409);
      }
      return updateResponse(request, itemId, { ...stored.response, replayed: true }, itemType);
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
      p_item_id: itemId,
      p_expected_updated_at: preview.expectedUpdatedAt,
      p_idempotency_key: idempotencyKey,
      p_request_hash: planningItemUpdateHash({
        itemId,
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
    return updateResponse(request, itemId, transaction, preview.itemType, preview.changedFields, preview.systemEffects);
  });
}
