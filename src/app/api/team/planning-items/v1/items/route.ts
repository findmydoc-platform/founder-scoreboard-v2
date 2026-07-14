import type { NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { isUuid } from "@/features/planning-items/model/planning-items-contract";
import { handlePlanningItemsRequest, planningItemsError, planningItemsJson } from "@/features/planning-items/model/planning-items-route";
import {
  buildPlanningItemCreatePreview,
  parsePlanningItemCreatePayload,
  planningItemCreateCommitItem,
  planningItemCreateHash,
  planningItemCreateRequiresOperationalLead,
} from "@/features/planning-items/model/planning-items-create";

export async function POST(request: NextRequest) {
  return handlePlanningItemsRequest(request, "write:planning-items:create", "Planning-Items-Erstellung konnte nicht gespeichert werden.", async (permission) => {
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() || "";
    if (!isUuid(idempotencyKey)) return planningItemsError("Gültiger UUID-Idempotency-Key ist erforderlich.", 400);
    const parsed = parsePlanningItemCreatePayload(await request.json().catch(() => null));
    if (!parsed.ok) return planningItemsError(parsed.error, 400);
    if (planningItemCreateRequiresOperationalLead(parsed.items)
      && !["ceo", "deputy"].includes(permission.profile.platformRole)) {
      return planningItemsError("Nur CEO oder Deputy können Meilensteine anlegen.", 403);
    }
    const items = await buildPlanningItemCreatePreview(parsed.items, permission.profile, permission.supabase);
    if (items.some((item) => item.errors.length)) return planningItemsJson({ ok: false, error: "Planning-Items-Erstellung enthält ungültige Einträge.", items }, 400);
    const metadata = auditRequestMetadata(request);
    const { data, error } = await permission.supabase.rpc("create_team_planning_items_transaction", {
      p_token_id: permission.tokenId,
      p_profile_id: permission.profile.id,
      p_idempotency_key: idempotencyKey,
      p_request_hash: planningItemCreateHash(items),
      p_items: items.map(planningItemCreateCommitItem),
      p_request_ip: metadata.request_ip,
      p_user_agent: metadata.user_agent || null,
    });
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    return planningItemsJson({ ok: true, ...(data as object) });
  });
}
