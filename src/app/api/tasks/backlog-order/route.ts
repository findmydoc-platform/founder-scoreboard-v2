import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { apiError, requireApiContext } from "@/lib/api-response";
import { requireFounder } from "@/lib/authz";
import { isOperationalLeadRole } from "@/lib/platform";

type BacklogOrderUpdate = {
  id: string;
  sortOrder: number;
  expectedUpdatedAt: string;
};

function parseBacklogOrderUpdates(payload: unknown): BacklogOrderUpdate[] | string {
  const updates = (payload as { updates?: unknown })?.updates;
  if (!Array.isArray(updates) || updates.length === 0) return "Mindestens eine Backlog-Änderung ist erforderlich.";
  if (updates.length > 250) return "Zu viele Backlog-Änderungen in einer Anfrage.";

  const seen = new Set<string>();
  const parsed: BacklogOrderUpdate[] = [];
  for (const update of updates) {
    const candidate = update as Partial<Record<keyof BacklogOrderUpdate, unknown>>;
    const id = typeof candidate.id === "string" ? candidate.id.trim() : "";
    const sortOrder = typeof candidate.sortOrder === "number" ? candidate.sortOrder : Number.NaN;
    const expectedUpdatedAt = typeof candidate.expectedUpdatedAt === "string" ? candidate.expectedUpdatedAt : "";
    if (!id || !Number.isInteger(sortOrder) || sortOrder < 0 || !expectedUpdatedAt || Number.isNaN(Date.parse(expectedUpdatedAt))) {
      return "Backlog-Änderung ist ungültig.";
    }
    if (seen.has(id)) return "Backlog-Änderung enthält doppelte Aufgaben.";
    seen.add(id);
    parsed.push({ id, sortOrder, expectedUpdatedAt });
  }
  return parsed;
}

export async function PATCH(request: NextRequest) {
  const apiContext = await requireApiContext(request, requireFounder, {
    supabaseUnavailableMessage: "Backlog-Reihenfolge konnte nicht dauerhaft gespeichert werden.",
  });
  if (!apiContext.ok) return apiContext.response;

  const { permission, supabase } = apiContext;
  if (!isOperationalLeadRole(permission.profile?.platformRole)) {
    return apiError("Nur CEO oder Deputy können die Backlog-Reihenfolge ändern.", 403);
  }

  const payload = await request.json().catch(() => null);
  const updates = parseBacklogOrderUpdates(payload);
  if (typeof updates === "string") return apiError(updates, 400);

  const metadata = auditRequestMetadata(request);
  const { data: transactionData, error: transactionError } = await supabase.rpc("update_backlog_order_transaction", {
    p_updates: updates,
    p_actor_profile_id: permission.profile?.id || null,
    p_request_ip: metadata.request_ip,
    p_user_agent: metadata.user_agent || null,
  });
  if (transactionError) {
    if (transactionError.code === "P0001") return apiError("Backlog wurde parallel geändert. Bitte neu laden.", 409);
    if (transactionError.code === "P0002") return apiError("Mindestens eine Aufgabe wurde nicht gefunden.", 404);
    if (transactionError.code === "22023") return apiError("Backlog-Änderung ist ungültig.", 400);
    return apiError(transactionError.message, 500);
  }

  return NextResponse.json({ ok: true, updates: transactionData || [] });
}
