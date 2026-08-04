import type { NextRequest } from "next/server";
import { handlePlanningItemsRequest, planningItemsError, planningItemsJson } from "@/features/planning-items/model/planning-items-route";
import {
  buildPlanningItemCreatePreview,
  parsePlanningItemCreatePayload,
  planningItemCreateRequiresOperationalLead,
} from "@/features/planning-items/model/planning-items-create";

export async function POST(request: NextRequest) {
  return handlePlanningItemsRequest(request, "write:planning-items:create", "Planning-Items-Erstellung konnte nicht geprüft werden.", async (permission) => {
    const parsed = parsePlanningItemCreatePayload(await request.json().catch(() => null));
    if (!parsed.ok) return planningItemsError(parsed.error, 400);
    if (parsed.githubSyncMode
      && !permission.scopes.includes("write:planning-items:github-sync")) {
      return planningItemsError("Planning-API-Token hat nicht den erforderlichen GitHub-Sync-Scope.", 403);
    }
    if (planningItemCreateRequiresOperationalLead(parsed.items)
      && !["ceo", "deputy"].includes(permission.profile.platformRole)) {
      return planningItemsError("Nur CEO oder Deputy können Epics anlegen.", 403);
    }
    const items = await buildPlanningItemCreatePreview(parsed.items, permission.profile, permission.supabase);
    return planningItemsJson({ ok: true, valid: items.every((item) => !item.errors.length), items });
  });
}
