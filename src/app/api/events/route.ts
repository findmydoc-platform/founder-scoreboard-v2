import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata } from "@/lib/api-input";
import { bearerToken, requireOperationalLeadOrActiveAdministrator } from "@/lib/authz";
import { assertFounderEventParticipantsExist, buildFounderEventCreateRow, founderEventSelect, validateFounderEventRow, type EventPayload } from "@/features/events/model/event-api";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { mapFounderEvent } from "@/lib/planning-row-mappers";
import { invalidateSharedPlanningHeaderCache } from "@/lib/planning-header-cache";
import { getSupabaseForToken } from "@/lib/supabase";

export async function POST(request: NextRequest) {
  const context = await requireJsonApiContext<EventPayload>(request, requireOperationalLeadOrActiveAdministrator, {});
  if (!context.ok) return context.response;

  const { payload, permission, supabase } = context;
  if (!permission.profile) return apiError("Profil konnte nicht bestimmt werden.", 403);
  const administratorMutation = permission.authority?.capabilities.operationalCorrection === true;
  const writeSupabase = administratorMutation ? getSupabaseForToken(bearerToken(request)) : supabase;
  if (!writeSupabase) return apiError("Anmeldung erforderlich.", 401);

  const row = buildFounderEventCreateRow(payload, permission.profile.id);
  const validationError = validateFounderEventRow(row);
  if (validationError) return apiError(validationError.message, validationError.status);
  const participantError = await assertFounderEventParticipantsExist(supabase, row.participant_profile_ids);
  if (participantError) return apiError(participantError, participantError.includes("nicht gefunden") ? 404 : 500);

  const { data: event, error } = await writeSupabase
    .from("founder_events")
    .insert(row)
    .select(founderEventSelect)
    .single();

  if (error || !event) return apiError(error?.message || "Event konnte nicht angelegt werden.", 500);

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile.id,
    action: "founder_event.create",
    entity_type: "founder_event",
    entity_id: String(event.id),
    after_data: row,
    ...auditRequestMetadata(request),
  });

  invalidateSharedPlanningHeaderCache("calendarEvents");

  return NextResponse.json({ event: mapFounderEvent(event) });
}
