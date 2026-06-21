import type { AvailabilityEntry } from "@/lib/types";

import { minutesToTime } from "@/features/meetings/model/meeting-time";

export const weekdayOptions = [
  { value: "1", label: "Montag" },
  { value: "2", label: "Dienstag" },
  { value: "3", label: "Mittwoch" },
  { value: "4", label: "Donnerstag" },
  { value: "5", label: "Freitag" },
  { value: "6", label: "Samstag" },
  { value: "0", label: "Sonntag" },
];

export const blockerKindOptions: Array<{ value: AvailabilityEntry["blockerKind"]; label: string }> = [
  { value: "on_business", label: "On Business" },
  { value: "customer_appointment", label: "Kundentermin" },
  { value: "internal_meeting", label: "Internes Meeting" },
  { value: "focus_time", label: "Fokuszeit" },
  { value: "admin", label: "Admin / Orga" },
  { value: "travel", label: "Reise / Anfahrt" },
  { value: "private_appointment", label: "Privater Termin" },
  { value: "vacation", label: "Urlaub" },
  { value: "sick", label: "Krank" },
  { value: "care", label: "Care-Arbeit" },
  { value: "other", label: "Sonstiges" },
];

export const durationOptions = [
  { value: "30", label: "30 Minuten" },
  { value: "45", label: "45 Minuten" },
  { value: "60", label: "60 Minuten" },
  { value: "90", label: "90 Minuten" },
  { value: "custom", label: "Eigene Dauer" },
];

export const timeOptions = Array.from({ length: 35 }, (_, index) => {
  const minutes = 6 * 60 + index * 30;
  const value = minutesToTime(minutes);
  return { value, label: value };
});
