import { linkedTaskBrief } from "@/lib/github-brief-references";
import { resolveTaskGitHubRepository } from "@/lib/github-repositories";
import type { NextRequest } from "next/server";
import {
  parsePlanningItemPatchPayload,
} from "@/features/planning-items/model/planning-item-update";
import {
  handlePlanningItemsRequest,
  planningItemsError,
  planningItemsJson,
} from "@/features/planning-items/model/planning-items-route";
import { previewPlanningItemGitHubSync } from "@/features/planning-items/model/planning-items-github-sync-preview";
import { isStrategicPlanningItemType } from "@/features/planning-items/model/planning-items-contract";

export async function handleTeamPlanningItemUpdatePreview(
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
    itemId: (await context.params).id.trim(),
    mode: "preview",
    requiresGitHubSync: async () => {
      const payload = await parseRequest();
      return Boolean(payload.ok && payload.githubSyncMode);
    },
  }, "Planning-Items-Update konnte nicht geprüft werden.", async (permission) => {
    const parsed = await parseRequest();
    const { id } = await context.params;
    const itemId = id.trim();
    if (!itemId) return planningItemsError("Planungselement-ID ist erforderlich.", 400);

    if (!parsed.ok) return planningItemsError(parsed.error, 400);
    if (parsed.dependency) {
      const result = await permission.planningItems.buildDependencyPreview({
        expectedUpdatedAt: parsed.expectedUpdatedAt,
        dependency: parsed.dependency,
      });
      if (!result.ok) return planningItemsError(result.error, result.status);
      const repository = resolveTaskGitHubRepository(result.preview.itemType, String(result.preview.resultingItem.githubRepo || ""));
      return planningItemsJson({
        ok: true, valid: true, ...result.preview,
        ...(!isStrategicPlanningItemType(result.preview.itemType) ? {
          linkedBrief: linkedTaskBrief(result.preview.resultingItem, { githubRepo: repository.ok ? repository.repository : "" }),
        } : {}),
      });
    }

    const result = await permission.planningItems.buildUpdatePreview({
      parsed,
    });
    if (!result.ok) return planningItemsError(result.error, result.status);

    const { preview } = result;
    const reviseResult = await result.validate();
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
      ...(preview.linkedBrief ? { linkedBrief: preview.linkedBrief } : {}),
      changedFields: preview.changedFields,
      systemEffects: preview.systemEffects,
      errors: preview.errors,
      ...(preview.lengthErrors?.length ? { lengthErrors: preview.lengthErrors } : {}),
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
