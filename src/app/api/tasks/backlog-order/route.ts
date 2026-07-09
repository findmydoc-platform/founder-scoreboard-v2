import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { apiError, requireApiContext } from "@/lib/api-response";
import { requireFounder } from "@/lib/authz";
import { isOperationalLeadRole } from "@/lib/platform";

type BacklogOrderUpdate = {
  id: string;
  sortOrder: number;
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
    if (!id || !Number.isInteger(sortOrder) || sortOrder < 0) return "Backlog-Änderung ist ungültig.";
    if (seen.has(id)) return "Backlog-Änderung enthält doppelte Aufgaben.";
    seen.add(id);
    parsed.push({ id, sortOrder });
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

  const ids = updates.map((update) => update.id);
  const { data: existingRows, error: existingError } = await supabase
    .from("tasks")
    .select("id,sort_order")
    .in("id", ids);
  if (existingError) return apiError(existingError.message, 500);
  if ((existingRows || []).length !== ids.length) return apiError("Mindestens eine Aufgabe wurde nicht gefunden.", 404);

  for (const update of updates) {
    const { error } = await supabase
      .from("tasks")
      .update({ sort_order: update.sortOrder })
      .eq("id", update.id);
    if (error) return apiError(error.message, 500);
  }

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile?.id || null,
    action: "task.backlog_reorder",
    entity_type: "task",
    entity_id: "backlog",
    before_data: { tasks: existingRows || [] },
    after_data: { updates },
    ...auditRequestMetadata(request),
  });

  return NextResponse.json({ ok: true, updates });
}
