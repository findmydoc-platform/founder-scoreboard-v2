import type { NextRequest } from "next/server";
import {
  buildPlanningItemUpdatePreview,
  parsePlanningItemPatchPayload,
} from "@/features/planning-items/model/planning-item-update";
import {
  handlePlanningItemsRequest,
  planningItemsError,
  planningItemsJson,
} from "@/features/planning-items/model/planning-items-route";
import { previewPlanningItemGitHubSync } from "@/features/planning-items/model/planning-items-github-sync-preview";
import { isStrategicPlanningItemType } from "@/features/planning-items/model/planning-items-contract";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handlePlanningItemsRequest(request, "write:planning-items:update", "Planning-Items-Update konnte nicht geprüft werden.", async (permission) => {
    const { id } = await context.params;
    const itemId = id.trim();
    if (!itemId) return planningItemsError("Planungselement-ID ist erforderlich.", 400);

    const parsed = parsePlanningItemPatchPayload(await request.json().catch(() => null));
    if (!parsed.ok) return planningItemsError(parsed.error, 400);
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
