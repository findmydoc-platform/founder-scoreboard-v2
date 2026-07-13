import type { NextRequest } from "next/server";
import { handlePlanningItemsRequest, planningItemsError, planningItemsJson } from "@/features/planning-items/model/planning-items-route";
import { buildPlanningItemCreatePreview, parsePlanningItemCreatePayload } from "@/features/planning-items/model/planning-items-create";

export async function POST(request: NextRequest) {
  return handlePlanningItemsRequest(request, "write:planning-items:create", "Planning-Items-Erstellung konnte nicht geprüft werden.", async (permission) => {
    const parsed = parsePlanningItemCreatePayload(await request.json().catch(() => null));
    if (!parsed.ok) return planningItemsError(parsed.error, 400);
    const items = await buildPlanningItemCreatePreview(parsed.items, permission.profile, permission.supabase);
    return planningItemsJson({ ok: true, valid: items.every((item) => !item.errors.length), items });
  });
}
