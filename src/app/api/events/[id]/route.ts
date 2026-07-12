import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { requireOperationalLead } from "@/lib/authz";
import { assertFounderEventParticipantsExist, buildFounderEventUpdatePatch, founderEventSelect, validateFounderEventRow, type EventPayload } from "@/features/events/model/event-api";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { mapFounderEvent } from "@/lib/planning-data-mappers";
import { invalidateSharedPlanningHeaderCache } from "@/lib/planning-header-cache";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const apiContext = await requireJsonApiContext<EventPayload>(request, requireOperationalLead, {});
  if (!apiContext.ok) return apiContext.response;

  const { payload, permission, supabase } = apiContext;
  if (!permission.profile) return apiError("Profil konnte nicht bestimmt werden.", 403);

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isFinite(id)) return apiError("Event ist erforderlich.", 400);

  const { data: current, error: currentError } = await supabase
    .from("founder_events")
    .select(founderEventSelect)
    .eq("id", id)
    .single();

  if (currentError || !current) return apiError("Event wurde nicht gefunden.", 404);

  const patch = buildFounderEventUpdatePatch(payload, current);
  const validationError = validateFounderEventRow(patch);
  if (validationError) return apiError(validationError.message, validationError.status);
  const participantError = await assertFounderEventParticipantsExist(supabase, patch.participant_profile_ids);
  if (participantError) return apiError(participantError, participantError.includes("nicht gefunden") ? 404 : 500);

  const { data: event, error } = await supabase
    .from("founder_events")
    .update(patch)
    .eq("id", id)
    .select(founderEventSelect)
    .single();

  if (error || !event) return apiError(error?.message || "Event konnte nicht aktualisiert werden.", 500);

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile.id,
    action: "founder_event.update",
    entity_type: "founder_event",
    entity_id: String(id),
    before_data: current,
    after_data: patch,
    ...auditRequestMetadata(request),
  });

  invalidateSharedPlanningHeaderCache("calendarEvents");

  return NextResponse.json({ event: mapFounderEvent(event) });
}
