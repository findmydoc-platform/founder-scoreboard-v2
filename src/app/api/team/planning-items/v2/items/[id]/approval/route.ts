import type { NextRequest } from "next/server";
import { isUuid } from "@/features/planning-items/model/planning-items-contract";
import { mapPlanningItemDatabaseRow } from "@/features/planning-items/model/planning-item-update";
import { handlePlanningItemsRequest, planningItemsError, planningItemsJson } from "@/features/planning-items/model/planning-items-route";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const itemId = (await context.params).id.trim();
  return handlePlanningItemsRequest(request, { operation: "planningItems.approve", mode: "commit", itemId },
    "Freigabe konnte nicht gespeichert werden.", async (permission) => {
      if (!["ceo", "deputy"].includes(permission.profile.platformRole)) {
        return planningItemsError("Nur CEO oder Deputy können Planungselemente freigeben.", 403);
      }
      if (!itemId) return planningItemsError("Planungselement-ID ist erforderlich.", 400);
      const key = request.headers.get("idempotency-key")?.trim() || "";
      if (!isUuid(key)) return planningItemsError("Gültiger UUID-Idempotency-Key ist erforderlich.", 400);
      const body: unknown = await request.json().catch(() => null);
      if (!body || typeof body !== "object" || Array.isArray(body)
        || Object.keys(body).length !== 1 || !("expectedApprovalRevision" in body)
        || !Number.isSafeInteger(body.expectedApprovalRevision) || Number(body.expectedApprovalRevision) < 1
        || Number(body.expectedApprovalRevision) > 2147483647) {
        return planningItemsError("Aktuelle Freigabe-Revision ist erforderlich; weitere Felder sind nicht zulässig.", 400);
      }
      const result = await permission.planningItems.approve(Number(body.expectedApprovalRevision), key);
      const itemType = result.task.task_type;
      if (itemType !== "initiative" && itemType !== "deliverable") throw new Error("Ungültiger Freigabetyp.");
      return planningItemsJson({
        ok: true,
        replayed: result.replayed,
        itemType,
        item: mapPlanningItemDatabaseRow(itemType, result.task),
        itemLink: `${request.nextUrl.origin}/tasks/${encodeURIComponent(itemId)}`,
        lifecycle: result.lifecycle,
      });
    });
}
