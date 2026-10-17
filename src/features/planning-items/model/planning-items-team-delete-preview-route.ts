import type { NextRequest } from "next/server";
import {
  emptyEpicDeleteCommand,
  emptyEpicDeleteError,
  emptyEpicDeletePreview,
  parseEmptyEpicDeletePayload,
} from "@/features/planning-items/model/planning-items-empty-epic-delete";
import {
  handlePlanningItemsRequest,
  planningItemsError,
  planningItemsJson,
} from "@/features/planning-items/model/planning-items-route";

export async function handleTeamPlanningItemDeletePreview(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  return handlePlanningItemsRequest(
    request,
    {
      operation: "planningItems.deleteEmpty",
      itemId: (await context.params).id.trim(),
      mode: "preview",
    },
    "Planning-Items-Löschung konnte nicht geprüft werden.",
    async (permission) => {
      const { id } = await context.params;
      const itemId = id.trim();
      if (!itemId) return planningItemsError("Planungselement-ID ist erforderlich.", 400);

      const parsed = parseEmptyEpicDeletePayload(await request.json().catch(() => null));
      if (!parsed.ok) return planningItemsError(parsed.error, 400);
      if (!await permission.planningItems.hasCanonicalItem()) {
        return planningItemsError("Planungselement wurde nicht gefunden.", 404);
      }
      const result = await permission.planningItems.delete({
        command: emptyEpicDeleteCommand(itemId, parsed.expectedUpdatedAt),
      });
      if (!result.ok) {
        const mapped = emptyEpicDeleteError(result.error);
        return planningItemsError(mapped.message, mapped.status);
      }
      const preview = emptyEpicDeletePreview(result);
      if (!preview) throw new Error("Planning-Items-Löschprüfung lieferte kein Ergebnis zurück.");

      return planningItemsJson({
        ok: true,
        ...preview,
        code: preview.code ? "EPIC_NOT_EMPTY" : null,
      });
    },
  );
}
