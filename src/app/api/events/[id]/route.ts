import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { requireOperationalLead } from "@/lib/authz";
import { cleanEventDateTime, cleanEventProfileIds, cleanEventReminderDays, eventCategories, eventStatuses, founderEventSelect, type EventPayload } from "@/features/events/model/event-api";
import { apiError, requireJsonApiContext } from "@/lib/api-response";
import { mapFounderEvent } from "@/lib/planning-data-mappers";

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

  const title = typeof payload.title === "string" ? cleanText(payload.title, 180) : current.title;
  const category = typeof payload.category === "string" && eventCategories.has(payload.category) ? payload.category : current.category;
  const startsAt = typeof payload.startsAt === "string" ? cleanEventDateTime(payload.startsAt) : current.starts_at;
  const endsAt = typeof payload.endsAt === "string" ? cleanEventDateTime(payload.endsAt) || null : current.ends_at;
  const location = typeof payload.location === "string" ? cleanText(payload.location, 240) : current.location || "";
  const description = typeof payload.description === "string" ? cleanText(payload.description, 3000) : current.description || "";
  const audienceMode = payload.audienceMode === "selected" ? "selected" : payload.audienceMode === "all" ? "all" : current.audience_mode;
  const participantProfileIds = audienceMode === "selected"
    ? (Array.isArray(payload.participantProfileIds) ? cleanEventProfileIds(payload.participantProfileIds) : current.participant_profile_ids || [])
    : [];
  const reminderDaysBefore = cleanEventReminderDays(payload.reminderDaysBefore, current.reminder_days_before);
  const status = typeof payload.status === "string" && eventStatuses.has(payload.status) ? payload.status : current.status;

  if (!title) return apiError("Titel ist erforderlich.", 400);
  if (!startsAt) return apiError("Startzeitpunkt ist erforderlich.", 400);
  if (endsAt && endsAt < startsAt) return apiError("Ende darf nicht vor dem Start liegen.", 400);
  if (audienceMode === "selected" && !participantProfileIds.length) return apiError("Mindestens ein Profil ist für diese Zielgruppe erforderlich.", 400);

  if (participantProfileIds.length) {
    const profileResult = await supabase.from("profiles").select("id").in("id", participantProfileIds);
    if (profileResult.error) return apiError(profileResult.error.message, 500);
    if ((profileResult.data || []).length !== participantProfileIds.length) return apiError("Mindestens ein Zielprofil wurde nicht gefunden.", 404);
  }

  const reminderRelevantChange =
    startsAt !== current.starts_at ||
    endsAt !== current.ends_at ||
    audienceMode !== current.audience_mode ||
    reminderDaysBefore !== current.reminder_days_before ||
    participantProfileIds.join("|") !== (current.participant_profile_ids || []).join("|");

  const patch = {
    title,
    category,
    starts_at: startsAt,
    ends_at: endsAt,
    location,
    description,
    audience_mode: audienceMode,
    participant_profile_ids: participantProfileIds,
    reminder_days_before: reminderDaysBefore,
    reminder_generated_at: reminderRelevantChange ? null : current.reminder_generated_at,
    status,
    updated_at: new Date().toISOString(),
  };

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

  return NextResponse.json({ event: mapFounderEvent(event) });
}
