import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { buildFounderEventUpdatePatch, validateFounderEventRow } from "@/features/events/model/event-api";
import { eventApiContext } from "@/features/events/model/event-api-context";
import { apiError } from "@/lib/api-response";
import { mapFounderEvent } from "@/lib/planning-row-mappers";
import { invalidateSharedPlanningHeaderCache } from "@/lib/planning-header-cache";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id: rawId } = await context.params;
  const apiContext = await eventApiContext(request, "events.update", rawId);
  if (!apiContext.ok) return apiContext.response;
  const { payload, permission, resource } = apiContext;
  if (!permission.profile) return apiError("Profil konnte nicht bestimmt werden.", 403);
  const id = Number(rawId);
  if (!Number.isFinite(id)) return apiError("Event ist erforderlich.", 400);
  const { data: current, error: currentError } = await resource.readEvent();
  if (currentError || !current) return apiError("Event wurde nicht gefunden.", 404);
  const patch = buildFounderEventUpdatePatch(payload, current);
  const validationError = validateFounderEventRow(patch);
  if (validationError) return apiError(validationError.message, validationError.status);
  if (payload.expectedUpdatedAt !== undefined && (typeof payload.expectedUpdatedAt !== "string" || !payload.expectedUpdatedAt)) return apiError("Die Ausgangsversion des Events fehlt.", 400);
  const result = await resource.saveEvent(patch, auditRequestMetadata(request), payload.expectedUpdatedAt);
  if (result.error?.code === "event_version_conflict") return NextResponse.json({ code: "event_version_conflict", error: result.error.message }, { status: 409 });
  if ("participantError" in result && result.participantError) return apiError(result.participantError, result.participantError.includes("nicht gefunden") ? 404 : 500);
  const { data: event, error } = result;
  if (error || !event) return apiError(error?.message || "Event konnte nicht aktualisiert werden.", 500);
  invalidateSharedPlanningHeaderCache("calendarEvents");
  return NextResponse.json({ event: mapFounderEvent(event), ...("auditUnconfirmed" in result && result.auditUnconfirmed ? { code: "event_saved_audit_unconfirmed", warning: "Event gespeichert. Die Protokollierung konnte nicht bestätigt werden." } : {}) });
}
