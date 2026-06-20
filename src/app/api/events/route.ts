import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { requireOperationalLead } from "@/lib/authz";
import type { FounderEvent } from "@/lib/types";
import { apiError, requireJsonApiContext } from "@/lib/api-response";

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

function cleanReminderDays(value: unknown) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 0 || days > 90) return 7;
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

export async function POST(request: NextRequest) {
  const context = await requireJsonApiContext<EventPayload>(request, requireOperationalLead, {});
  if (!context.ok) return context.response;

  const { payload, permission, supabase } = context;
  if (!permission.profile) return apiError("Profil konnte nicht bestimmt werden.", 403);

  const title = cleanText(payload.title, 180);
  const category = typeof payload.category === "string" && eventCategories.has(payload.category) ? payload.category : "other";
  const startsAt = cleanDateTime(payload.startsAt);
  const endsAt = cleanDateTime(payload.endsAt) || null;
  const location = cleanText(payload.location, 240);
  const description = cleanText(payload.description, 3000);
  const audienceMode = payload.audienceMode === "selected" ? "selected" : "all";
  const participantProfileIds = audienceMode === "selected" ? cleanProfileIds(payload.participantProfileIds) : [];
  const reminderDaysBefore = cleanReminderDays(payload.reminderDaysBefore);

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
    .select("id,title,category,starts_at,ends_at,location,description,audience_mode,participant_profile_ids,reminder_days_before,reminder_generated_at,status,created_by,created_at,updated_at")
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
