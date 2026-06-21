import type { FounderEvent } from "@/lib/types";

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
