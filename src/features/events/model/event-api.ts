import type { FounderEvent } from "@/lib/types";
import { cleanText } from "@/lib/api-input";
import { getServerSupabase } from "@/lib/supabase";

export type EventPayload = {
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

export const founderEventSelect = "id,title,category,starts_at,ends_at,location,description,audience_mode,participant_profile_ids,reminder_days_before,reminder_generated_at,status,created_by,created_at,updated_at";

export const eventCategories = new Set<FounderEvent["category"]>(["conference", "legal", "company", "travel", "deadline", "other"]);
export const eventStatuses = new Set<FounderEvent["status"]>(["planned", "done", "cancelled"]);

type SupabaseClient = NonNullable<ReturnType<typeof getServerSupabase>>;
type FounderEventRow = {
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
};

export function cleanEventDateTime(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{3})?Z?)?$/.test(value)) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function cleanEventProfileIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)));
}

export function cleanEventReminderDays(value: unknown, fallback = 7) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 0 || days > 90) return fallback;
  return days;
}

export function buildFounderEventCreateRow(payload: EventPayload, createdBy: string) {
  const audienceMode: FounderEvent["audienceMode"] = payload.audienceMode === "selected" ? "selected" : "all";
  return {
    title: cleanText(payload.title, 180),
    category: typeof payload.category === "string" && eventCategories.has(payload.category) ? payload.category : "other",
    starts_at: cleanEventDateTime(payload.startsAt),
    ends_at: cleanEventDateTime(payload.endsAt) || null,
    location: cleanText(payload.location, 240),
    description: cleanText(payload.description, 3000),
    audience_mode: audienceMode,
    participant_profile_ids: audienceMode === "selected" ? cleanEventProfileIds(payload.participantProfileIds) : [],
    reminder_days_before: cleanEventReminderDays(payload.reminderDaysBefore),
    reminder_generated_at: null,
    status: "planned" as const,
    created_by: createdBy,
    updated_at: new Date().toISOString(),
  };
}

export function buildFounderEventUpdatePatch(payload: EventPayload, current: FounderEventRow) {
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
  const reminderRelevantChange =
    startsAt !== current.starts_at ||
    endsAt !== current.ends_at ||
    audienceMode !== current.audience_mode ||
    reminderDaysBefore !== current.reminder_days_before ||
    participantProfileIds.join("|") !== (current.participant_profile_ids || []).join("|");

  return {
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
}

export function validateFounderEventRow(row: Pick<FounderEventRow, "title" | "starts_at" | "ends_at" | "audience_mode" | "participant_profile_ids">) {
  if (!row.title) return { message: "Titel ist erforderlich.", status: 400 };
  if (!row.starts_at) return { message: "Startzeitpunkt ist erforderlich.", status: 400 };
  if (row.ends_at && row.ends_at < row.starts_at) return { message: "Ende darf nicht vor dem Start liegen.", status: 400 };
  if (row.audience_mode === "selected" && !(row.participant_profile_ids || []).length) {
    return { message: "Mindestens ein Profil ist für diese Zielgruppe erforderlich.", status: 400 };
  }
  return null;
}

export async function assertFounderEventParticipantsExist(supabase: SupabaseClient, participantProfileIds: string[]) {
  if (!participantProfileIds.length) return "";
  const profileResult = await supabase.from("profiles").select("id").in("id", participantProfileIds);
  if (profileResult.error) return profileResult.error.message;
  return (profileResult.data || []).length !== participantProfileIds.length ? "Mindestens ein Zielprofil wurde nicht gefunden." : "";
}
