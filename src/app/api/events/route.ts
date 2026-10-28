import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { buildFounderEventCreateRow, validateFounderEventRow } from "@/features/events/model/event-api";
import { eventApiContext } from "@/features/events/model/event-api-context";
import { apiError } from "@/lib/api-response";
import { mapFounderEvent } from "@/lib/planning-row-mappers";
import { invalidateSharedPlanningHeaderCache } from "@/lib/planning-header-cache";

export async function POST(request: NextRequest) {
  const context = await eventApiContext(request, "events.create");
  if (!context.ok) return context.response;
  const { payload, permission, resource } = context;
  if (!permission.profile) return apiError("Profil konnte nicht bestimmt werden.", 403);
  const row = buildFounderEventCreateRow(payload, permission.profile.id);
  const validationError = validateFounderEventRow(row);
  if (validationError) return apiError(validationError.message, validationError.status);
  const result = await resource.saveEvent(row, auditRequestMetadata(request));
  if ("participantError" in result && result.participantError) return apiError(result.participantError, result.participantError.includes("nicht gefunden") ? 404 : 500);
  const { data: event, error } = result;
  if (error || !event) return apiError(error?.message || "Event konnte nicht angelegt werden.", 500);
  invalidateSharedPlanningHeaderCache("calendarEvents");
  return NextResponse.json({ event: mapFounderEvent(event), ...("auditUnconfirmed" in result && result.auditUnconfirmed ? { code: "event_saved_audit_unconfirmed", warning: "Event gespeichert. Die Protokollierung konnte nicht bestätigt werden." } : {}) });
}
