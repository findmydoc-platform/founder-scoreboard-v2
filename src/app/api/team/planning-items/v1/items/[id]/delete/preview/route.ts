import type { NextRequest } from "next/server";
import { actorContextFromPlanningTokenAuth } from "@/features/planning-items/model/planning-actor-context-server";
import {
  createEmptyEpicDeletePlanningItems,
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

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  return handlePlanningItemsRequest(
    request,
    "write:planning-items:delete-empty",
    "Planning-Items-Löschung konnte nicht geprüft werden.",
    async (permission) => {
      const { id } = await context.params;
      const itemId = id.trim();
      if (!itemId) return planningItemsError("Planungselement-ID ist erforderlich.", 400);

      const parsed = parseEmptyEpicDeletePayload(await request.json().catch(() => null));
      if (!parsed.ok) return planningItemsError(parsed.error, 400);

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
      const result = await createEmptyEpicDeletePlanningItems(permission.supabase).run({
        actor: actor.actor,
        mode: "preview",
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
        code: preview.code ? "MILESTONE_NOT_EMPTY" : null,
      });
    },
  );
}
