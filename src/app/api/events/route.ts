import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { requireOperationalLead } from "@/lib/authz";
import { cleanEventDateTime, cleanEventProfileIds, cleanEventReminderDays, eventCategories, founderEventSelect, type EventPayload } from "@/features/events/model/event-api";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { mapFounderEvent } from "@/lib/planning-data-mappers";

export async function POST(request: NextRequest) {
  const context = await requireJsonApiContext<EventPayload>(request, requireOperationalLead, {});
  if (!context.ok) return context.response;

  const { payload, permission, supabase } = context;
  if (!permission.profile) return apiError("Profil konnte nicht bestimmt werden.", 403);

  const title = cleanText(payload.title, 180);
  const category = typeof payload.category === "string" && eventCategories.has(payload.category) ? payload.category : "other";
  const startsAt = cleanEventDateTime(payload.startsAt);
  const endsAt = cleanEventDateTime(payload.endsAt) || null;
  const location = cleanText(payload.location, 240);
  const description = cleanText(payload.description, 3000);
  const audienceMode = payload.audienceMode === "selected" ? "selected" : "all";
  const participantProfileIds = audienceMode === "selected" ? cleanEventProfileIds(payload.participantProfileIds) : [];
  const reminderDaysBefore = cleanEventReminderDays(payload.reminderDaysBefore);

  if (!title) return apiError("Titel ist erforderlich.", 400);
  if (!startsAt) return apiError("Startzeitpunkt ist erforderlich.", 400);
  if (endsAt && endsAt < startsAt) return apiError("Ende darf nicht vor dem Start liegen.", 400);
  if (audienceMode === "selected" && !participantProfileIds.length) return apiError("Mindestens ein Profil ist für diese Zielgruppe erforderlich.", 400);

  if (participantProfileIds.length) {
    const profileResult = await supabase.from("profiles").select("id").in("id", participantProfileIds);
    if (profileResult.error) return apiError(profileResult.error.message, 500);
    if ((profileResult.data || []).length !== participantProfileIds.length) return apiError("Mindestens ein Zielprofil wurde nicht gefunden.", 404);
  }

  const row = {
    title,
    category,
    starts_at: startsAt,
    ends_at: endsAt,
    location,
    description,
    audience_mode: audienceMode,
    participant_profile_ids: participantProfileIds,
    reminder_days_before: reminderDaysBefore,
    reminder_generated_at: null,
    status: "planned",
    created_by: permission.profile.id,
    updated_at: new Date().toISOString(),
  };

  const { data: event, error } = await supabase
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

  return NextResponse.json({ event: mapFounderEvent(event) });
}
