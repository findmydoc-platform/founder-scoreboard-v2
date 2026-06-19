import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { requireOperationalLead } from "@/lib/authz";
import { getServerSupabase } from "@/lib/supabase";
import type { FounderEvent } from "@/lib/types";
import { apiError, authzError, supabaseUnavailable } from "@/lib/api-response";

type EventPayload = {
  title?: string;
  category?: FounderEvent["category"];
  startsAt?: string;
  endsAt?: string;
  location?: string;
  description?: string;
  audienceMode?: FounderEvent["audienceMode"];
  participantProfileIds?: string[];
  reminderDaysBefore?: number;
  status?: FounderEvent["status"];
};

const eventCategories = new Set(["conference", "legal", "company", "travel", "deadline", "other"]);
const eventStatuses = new Set(["planned", "done", "cancelled"]);

function cleanDateTime(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{3})?Z?)?$/.test(value)) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

function cleanProfileIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)));
}

function cleanReminderDays(value: unknown, fallback: number) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 0 || days > 90) return fallback;
  return days;
}

function mapFounderEvent(row: {
  id: number;
  title: string;
  category: FounderEvent["category"];
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  description: string | null;
  audience_mode: FounderEvent["audienceMode"];
  participant_profile_ids: string[] | null;
  reminder_days_before: number;
  reminder_generated_at: string | null;
  status: FounderEvent["status"];
  created_by: string | null;
  created_at: string;
  updated_at: string;
}): FounderEvent {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    startsAt: row.starts_at,
    endsAt: row.ends_at || row.starts_at,
    location: row.location || "",
    description: row.description || "",
    audienceMode: row.audience_mode,
    participantProfileIds: row.participant_profile_ids || [],
    reminderDaysBefore: row.reminder_days_before,
    reminderGeneratedAt: row.reminder_generated_at || "",
    status: row.status,
    createdBy: row.created_by || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const supabase = getServerSupabase();
  if (!supabase) return supabaseUnavailable();

  const permission = await requireOperationalLead(request);
  if (!permission.ok) return authzError(permission);
  if (!permission.profile) return apiError("Profil konnte nicht bestimmt werden.", 403);

  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isFinite(id)) return apiError("Event ist erforderlich.", 400);

  const { data: current, error: currentError } = await supabase
    .from("founder_events")
    .select("id,title,category,starts_at,ends_at,location,description,audience_mode,participant_profile_ids,reminder_days_before,reminder_generated_at,status,created_by,created_at,updated_at")
    .eq("id", id)
    .single();

  if (currentError || !current) return apiError("Event wurde nicht gefunden.", 404);

  const payload = (await request.json().catch(() => ({}))) as EventPayload;
  const title = typeof payload.title === "string" ? cleanText(payload.title, 180) : current.title;
  const category = typeof payload.category === "string" && eventCategories.has(payload.category) ? payload.category : current.category;
  const startsAt = typeof payload.startsAt === "string" ? cleanDateTime(payload.startsAt) : current.starts_at;
  const endsAt = typeof payload.endsAt === "string" ? cleanDateTime(payload.endsAt) || null : current.ends_at;
  const location = typeof payload.location === "string" ? cleanText(payload.location, 240) : current.location || "";
  const description = typeof payload.description === "string" ? cleanText(payload.description, 3000) : current.description || "";
  const audienceMode = payload.audienceMode === "selected" ? "selected" : payload.audienceMode === "all" ? "all" : current.audience_mode;
  const participantProfileIds = audienceMode === "selected"
    ? (Array.isArray(payload.participantProfileIds) ? cleanProfileIds(payload.participantProfileIds) : current.participant_profile_ids || [])
    : [];
  const reminderDaysBefore = cleanReminderDays(payload.reminderDaysBefore, current.reminder_days_before);
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
    .select("id,title,category,starts_at,ends_at,location,description,audience_mode,participant_profile_ids,reminder_days_before,reminder_generated_at,status,created_by,created_at,updated_at")
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
