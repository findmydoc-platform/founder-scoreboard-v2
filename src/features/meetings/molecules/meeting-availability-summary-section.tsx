import {
  availabilityCalendarLabel,
  availabilityTone,
  blockerKindForAvailability,
  blockerKindLabel,
  formatDateLabel,
  weekdayForDate,
  weekdayOptions,
} from "@/features/meetings/model/meeting-finder";
import type { AvailabilityEntry } from "@/lib/types";

export function MeetingAvailabilitySummarySection({
  availability,
  calendarDates,
  workingHours,
  blockers,
  googleCalendarBlocksCount,
  googleCalendarProfilesCount,
  profileNameById,
  canManageAvailability,
  currentProfileId,
  pending,
  onDeleteAvailability,
}: {
  availability: AvailabilityEntry[];
  calendarDates: string[];
  workingHours: AvailabilityEntry[];
  blockers: AvailabilityEntry[];
  googleCalendarBlocksCount: number;
  googleCalendarProfilesCount: number;
  profileNameById: Map<string, string>;
  canManageAvailability: boolean;
  currentProfileId?: string;
  pending: boolean;
  onDeleteAvailability: (entry: AvailabilityEntry) => void;
}) {
  const summaryEntries = [...workingHours, ...blockers];

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
      <h2 className="text-base font-semibold text-slate-950">Kalenderwoche & Blocker</h2>
      <p className="mt-1 text-sm text-slate-500">Die nächsten Tage zeigen Arbeitszeiten, Abwesenheiten und später importierte Google-Kalenderblöcke zusammen.</p>
      <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-7">
        {calendarDates.map((date) => {
          const dayEntries = availability.filter((entry) => {
            if (entry.type === "working_hours") return entry.weekday === weekdayForDate(date);
            return (!entry.startDate || entry.startDate <= date) && (!entry.endDate || entry.endDate >= date);
          });
          return (
            <div key={date} className="min-h-36 rounded-lg border border-slate-100 bg-slate-50 p-2">
              <div className="text-xs font-semibold text-slate-700">{formatDateLabel(date)}</div>
              <div className="mt-2 grid gap-1">
                {dayEntries.slice(0, 6).map((entry, index) => (
                  <div key={`${date}-${entry.id}-${entry.profileId}-${entry.weekday ?? entry.startDate}-${index}`} className={`rounded-md border px-2 py-1 text-[11px] leading-4 ${availabilityTone(entry.type, entry.source)}`}>
                    <div className="font-semibold">{profileNameById.get(entry.profileId) || entry.profileId}</div>
                    <div>{availabilityCalendarLabel(entry)} · {entry.startTime}-{entry.endTime}</div>
                  </div>
                ))}
                {!dayEntries.length && <div className="rounded-md border border-dashed border-slate-200 bg-white px-2 py-3 text-center text-xs text-slate-400">Keine Einträge</div>}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 grid gap-2 lg:grid-cols-2">
        {summaryEntries.slice(0, 16).map((entry, index) => (
          <div key={`${entry.id}-${entry.profileId}-${entry.type}-${entry.weekday ?? entry.startDate}-${entry.startTime}-${index}`} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2 text-sm">
            <div className="min-w-0">
              <div className="font-semibold text-slate-900">
                {profileNameById.get(entry.profileId) || entry.profileId} · {availabilityCalendarLabel(entry)}
                {entry.source === "google_calendar" ? " · Google Kalender" : ""}
              </div>
              <div className="mt-0.5 truncate text-xs text-slate-500">
                {entry.type === "working_hours"
                  ? `${weekdayOptions.find((item) => item.value === String(entry.weekday))?.label || "Wochentag"} · ${entry.startTime}-${entry.endTime}`
                  : `${blockerKindLabel(blockerKindForAvailability(entry))} · ${formatDateLabel(entry.startDate)} bis ${formatDateLabel(entry.endDate)} · ${entry.startTime}-${entry.endTime}`}
                {entry.note ? ` · ${entry.note}` : ""}
              </div>
            </div>
            {(canManageAvailability || entry.profileId === currentProfileId) && (
              <button type="button" onClick={() => onDeleteAvailability(entry)} disabled={pending} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                Löschen
              </button>
            )}
          </div>
        ))}
        {!summaryEntries.length && (
          <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 lg:col-span-2">
            Noch keine Arbeitszeiten oder Blocker hinterlegt.
          </div>
        )}
      </div>
      <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
        Kalenderstatus: {googleCalendarBlocksCount} importierte Google-Blöcke, {googleCalendarProfilesCount} Profil(e) für Sync aktiviert. Manuelle Arbeitszeiten bleiben führend; Google-Termine blockieren nur freie Slots.
      </div>
    </section>
  );
}
