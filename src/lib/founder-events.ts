import type { FounderEvent, Profile } from "./types";

export const founderEventCategories: Array<{ value: FounderEvent["category"]; label: string }> = [
  { value: "conference", label: "Messe / Konferenz" },
  { value: "legal", label: "Notar / Rechtliches" },
  { value: "company", label: "Company Event" },
  { value: "travel", label: "Reise" },
  { value: "deadline", label: "Frist" },
  { value: "other", label: "Sonstiges" },
];

export const founderEventStatuses: Array<{ value: FounderEvent["status"]; label: string }> = [
  { value: "planned", label: "Geplant" },
  { value: "done", label: "Erledigt" },
  { value: "cancelled", label: "Abgesagt" },
];

export function founderEventCategoryLabel(category: string) {
  return founderEventCategories.find((option) => option.value === category)?.label || "Sonstiges";
}

export function founderEventStatusLabel(status: string) {
  return founderEventStatuses.find((option) => option.value === status)?.label || status;
}

export function founderEventAudienceLabel(event: Pick<FounderEvent, "audienceMode" | "participantProfileIds">, profiles: Profile[]) {
  if (event.audienceMode === "all") return "Alle aktiven Profile";
  const names = event.participantProfileIds
    .map((profileId) => profiles.find((profile) => profile.id === profileId)?.name || profileId)
    .filter(Boolean);
  return names.length ? names.join(", ") : "Keine Zielgruppe";
}

export function eventDateTimeLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Berlin",
  }).format(date);
}

export function eventDateRangeLabel(event: Pick<FounderEvent, "startsAt" | "endsAt">) {
  if (!event.endsAt || event.endsAt === event.startsAt) return eventDateTimeLabel(event.startsAt);
  return `${eventDateTimeLabel(event.startsAt)} bis ${eventDateTimeLabel(event.endsAt)}`;
}

export function normalizeEventDateTimeInput(value: string) {
  if (!value) return "";
  return value.slice(0, 16);
}
