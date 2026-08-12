import type { NextRequest } from "next/server";
import {
  buildPlanningItemUpdatePreview,
  createTeamRevisePlanningItems,
  parsePlanningItemPatchPayload,
  planningItemReviseCommand,
} from "@/features/planning-items/model/planning-item-update";
import { actorContextFromPlanningTokenAuth } from "@/features/planning-items/model/planning-actor-context-server";
import {
  handlePlanningItemsRequest,
  planningItemsError,
  planningItemsJson,
} from "@/features/planning-items/model/planning-items-route";
import { previewPlanningItemGitHubSync } from "@/features/planning-items/model/planning-items-github-sync-preview";
import { isStrategicPlanningItemType } from "@/features/planning-items/model/planning-items-contract";

export async function handleTeamPlanningItemUpdatePreview(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handlePlanningItemsRequest(request, "write:planning-items:update", "Planning-Items-Update konnte nicht geprüft werden.", async (permission) => {
    const { id } = await context.params;
    const itemId = id.trim();
    if (!itemId) return planningItemsError("Planungselement-ID ist erforderlich.", 400);

    const parsed = parsePlanningItemPatchPayload(await request.json().catch(() => null));
    if (!parsed.ok) return planningItemsError(parsed.error, 400);
    if (parsed.hasLegacyAliases) {
      return planningItemsError("Legacy-Aliase sind nicht mehr zulässig. Verwende parentTaskId.", 400);
    }
    if (parsed.githubSyncMode
      && !permission.scopes.includes("write:planning-items:github-sync")) {
      return planningItemsError("Planning-API-Token hat nicht den erforderlichen GitHub-Sync-Scope.", 403);
    }

    const result = await buildPlanningItemUpdatePreview({
      actor: permission.profile,
      itemId,
      parsed,
      supabase: permission.supabase,
    });
    if (!result.ok) return planningItemsError(result.error, result.status);

    const { preview } = result;
    const actor = actorContextFromPlanningTokenAuth({
      ok: true,
      profile: { id: permission.profile.id, platformRole: permission.profile.platformRole },
      tokenId: permission.tokenId,
      scopes: permission.scopes,
    });
    if (!actor.ok) return planningItemsError("Planning-API-Berechtigung ist nicht mehr gültig.", 403);
    const reviseResult = await createTeamRevisePlanningItems({
      supabase: permission.supabase,
      actor: actor.actor,
      tokenId: permission.tokenId,
      itemId,
      parsed,
      preparedPreview: preview,
    }).run({
      actor: actor.actor,
      mode: "preview",
      command: planningItemReviseCommand(itemId, preview.itemType, parsed.expectedUpdatedAt, parsed.raw),
    });
    if (!reviseResult.ok && reviseResult.error.code !== "invalidCommand") {
      return planningItemsError("Planning-Items-Update konnte nicht geprüft werden.", 500);
    }
    return planningItemsJson({
      ok: true,
      valid: preview.errors.length === 0,
      itemId: preview.itemId,
      itemType: preview.itemType,
      expectedUpdatedAt: preview.expectedUpdatedAt,
      currentItem: preview.currentItem,
      normalizedPatch: preview.normalizedPatch,
      resultingItem: preview.resultingItem,
      changedFields: preview.changedFields,
      systemEffects: preview.systemEffects,
      errors: preview.errors,
      warnings: preview.warnings,
      ...(parsed.githubSync && !isStrategicPlanningItemType(preview.itemType) ? {
        githubSync: previewPlanningItemGitHubSync({
          itemType: preview.itemType,
          approvalStatus: preview.resultingItem.approvalStatus,
          parentApprovalStatus: preview.githubSyncParentApprovalStatus,
        }),
      } : {}),
    }, preview.errors.length ? 400 : 200);
  });
}
