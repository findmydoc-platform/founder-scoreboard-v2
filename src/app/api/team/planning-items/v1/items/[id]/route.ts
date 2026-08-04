import { auditRequestMetadata } from "@/lib/api-input";
import { after, type NextRequest } from "next/server";
import {
  isUuid,
  type PlanningItemGitHubSyncResult,
} from "@/features/planning-items/model/planning-items-contract";
import {
  parsePlanningItemDeletePayload,
  planningItemMilestoneDeleteHash,
} from "@/features/planning-items/model/planning-item-delete";
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
import {
  executePlanningItemGitHubSyncs,
  preflightPlanningItemGitHubSync,
  type PlanningItemGitHubSyncTarget,
} from "@/features/planning-items/model/planning-items-github-sync";
import {
  isMilestoneNotEmptyDatabaseError,
  loadMilestoneChildCounts,
  loadProjectMilestone,
  milestoneNotEmptyError,
} from "@/features/projects/model/milestone-server";

type UpdateTransactionResult = {
  replayed?: boolean;
  itemType?: "epic" | "initiative" | "deliverable" | "sub_issue";
  item?: Record<string, unknown>;
  changedFields?: string[];
  systemEffects?: unknown[];
  githubSync?: PlanningItemGitHubSyncResult;
};

type StoredUpdateRequest = {
  request_hash: string;
  response: UpdateTransactionResult | null;
};

type DeleteTransactionResult = {
  replayed?: boolean;
  itemType?: "epic";
  item?: Record<string, unknown>;
  children?: { initiatives?: number; tasks?: number };
};

function itemLink(request: NextRequest, _itemType: "epic" | "initiative" | "deliverable" | "sub_issue", itemId: string) {
  return `${request.nextUrl.origin}/tasks/${encodeURIComponent(itemId)}`;
}

function updateResponse(
  request: NextRequest,
  fallbackItemId: string,
  transaction: UpdateTransactionResult,
  fallbackItemType: "epic" | "initiative" | "deliverable" | "sub_issue",
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
      .select("request_hash,response")
      .eq("token_id", permission.tokenId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    const storedResponse = (stored: StoredUpdateRequest) => {
      const itemType = stored.response?.itemType;
      if (!itemType) throw new Error("Gespeicherte Planning-Items-Wiederholung ist unvollständig.");
      if (itemType === "epic" && !["ceo", "deputy"].includes(permission.profile.platformRole)) {
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

      const parsed = parsePlanningItemDeletePayload(await request.json().catch(() => null));
      if (!parsed.ok) return planningItemsError(parsed.error, 400);

      const metadata = auditRequestMetadata(request);
      const { data, error } = await permission.supabase.rpc("delete_team_planning_milestone_transaction", {
        p_token_id: permission.tokenId,
        p_profile_id: permission.profile.id,
        p_milestone_id: itemId,
        p_expected_updated_at: parsed.expectedUpdatedAt,
        p_idempotency_key: idempotencyKey,
        p_request_hash: planningItemMilestoneDeleteHash({ itemId, expectedUpdatedAt: parsed.expectedUpdatedAt }),
        p_request_ip: metadata.request_ip,
        p_user_agent: metadata.user_agent || null,
      });

      if (error && isMilestoneNotEmptyDatabaseError(error)) {
        const [freshTarget, freshChildren] = await Promise.all([
          loadProjectMilestone(permission.supabase, itemId),
          loadMilestoneChildCounts(permission.supabase, itemId),
        ]);
        if (!freshTarget.error && freshTarget.data && freshChildren.ok) {
          const children = freshChildren.counts;
          if (children.initiatives > 0 || children.tasks > 0) {
            return planningItemsJson({
              ok: false,
              ...milestoneNotEmptyError(children),
            }, 409);
          }
        }
      }
      if (error) throw Object.assign(new Error(error.message), { code: error.code });

      const transaction = data as DeleteTransactionResult | null;
      if (!transaction?.item) throw new Error("Planning-Items-Löschung lieferte kein Ergebnis zurück.");
      const item = mapPlanningItemDatabaseRow("epic", transaction.item);
      return planningItemsJson({
        ok: true,
        replayed: Boolean(transaction.replayed),
        itemType: "epic",
        item,
        children: {
          initiatives: Number(transaction.children?.initiatives || 0),
          tasks: Number(transaction.children?.tasks || 0),
        },
        itemLink: itemLink(request, "epic", String(item.id || itemId)),
      });
    },
  );
}
