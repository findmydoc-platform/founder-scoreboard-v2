import { CustomDatePicker } from "@/components/custom-date-picker";
import { CustomSelect } from "@/components/custom-select";
import { blockerKindOptions, timeOptions, timeToMinutes, weekdayOptions } from "@/lib/meeting-finder";
import type { AvailabilityEntry } from "@/lib/types";

type Option = { value: string; label: string };

export function MeetingAvailabilityForms({
  normalizedWorkProfileId,
  normalizedBlockerProfileId,
  profileOptions,
  canManageAvailability,
  pending,
  workWeekdays,
  workStart,
  workEnd,
  blockerTitle,
  blockerKind,
  blockerStartDate,
  blockerEndDate,
  blockerAllDay,
  blockerStartTime,
  blockerEndTime,
  blockerNote,
  onWorkProfileChange,
  onBlockerProfileChange,
  onWorkWeekdaysChange,
  onToggleWorkWeekday,
  onWorkStartChange,
  onWorkEndChange,
  onBlockerTitleChange,
  onBlockerKindChange,
  onBlockerStartDateChange,
  onBlockerEndDateChange,
  onBlockerAllDayChange,
  onBlockerStartTimeChange,
  onBlockerEndTimeChange,
  onBlockerNoteChange,
  onAddWorkingHours,
  onAddBlocker,
}: {
  normalizedWorkProfileId: string;
  normalizedBlockerProfileId: string;
  profileOptions: Option[];
  canManageAvailability: boolean;
  pending: boolean;
  workWeekdays: string[];
  workStart: string;
  workEnd: string;
  blockerTitle: string;
  blockerKind: AvailabilityEntry["blockerKind"];
  blockerStartDate: string;
  blockerEndDate: string;
  blockerAllDay: boolean;
  blockerStartTime: string;
  blockerEndTime: string;
  blockerNote: string;
  onWorkProfileChange: (value: string) => void;
  onBlockerProfileChange: (value: string) => void;
  onWorkWeekdaysChange: (value: string[]) => void;
  onToggleWorkWeekday: (weekday: string) => void;
  onWorkStartChange: (value: string) => void;
  onWorkEndChange: (value: string) => void;
  onBlockerTitleChange: (value: string) => void;
  onBlockerKindChange: (value: AvailabilityEntry["blockerKind"]) => void;
  onBlockerStartDateChange: (value: string) => void;
  onBlockerEndDateChange: (value: string) => void;
  onBlockerAllDayChange: (value: boolean) => void;
  onBlockerStartTimeChange: (value: string) => void;
  onBlockerEndTimeChange: (value: string) => void;
  onBlockerNoteChange: (value: string) => void;
  onAddWorkingHours: () => void;
  onAddBlocker: () => void;
}) {
  const profileSelectOptions = profileOptions.length ? profileOptions : [{ value: "", label: "Kein Profil" }];

  return (
    <>
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Arbeitszeiten pflegen</h2>
        <p className="mt-1 text-sm text-slate-500">Regelmäßige FindMyDoc-Zeit pro Person und mehrere Wochentage in einem Schritt.</p>
        <div className="mt-4 grid gap-3">
          <CustomSelect value={normalizedWorkProfileId} onChange={onWorkProfileChange} disabled={!canManageAvailability || !profileOptions.length || pending} className="h-9 text-sm" options={profileSelectOptions} />
          <div className="grid gap-2">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => onWorkWeekdaysChange(["1", "2", "3", "4", "5"])} className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                Mo-Fr auswählen
              </button>
              <button type="button" onClick={() => onWorkWeekdaysChange(["6", "0"])} className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                Wochenende
              </button>
              <button type="button" onClick={() => onWorkWeekdaysChange(["0"])} className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                Nur Sonntag
              </button>
              <button type="button" onClick={() => onWorkWeekdaysChange(weekdayOptions.map((item) => item.value))} className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                Alle Tage
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {weekdayOptions.map((option) => (
                <button
                  key={`work-weekday-${option.value}`}
                  type="button"
                  onClick={() => onToggleWorkWeekday(option.value)}
                  className={`h-9 rounded-md border px-3 text-left text-xs font-semibold ${
                    workWeekdays.includes(option.value)
                      ? "border-blue-300 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <CustomSelect value={workStart} onChange={onWorkStartChange} disabled={pending} className="h-9 text-sm" options={timeOptions} aria-label="Arbeitszeit Start" />
            <CustomSelect value={workEnd} onChange={onWorkEndChange} disabled={pending} className="h-9 text-sm" options={timeOptions} aria-label="Arbeitszeit Ende" />
          </div>
          <button type="button" onClick={onAddWorkingHours} disabled={pending || !normalizedWorkProfileId || !workWeekdays.length || timeToMinutes(workStart) >= timeToMinutes(workEnd)} className="h-9 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
            Arbeitszeiten für {workWeekdays.length || 0} Tag{workWeekdays.length === 1 ? "" : "e"} speichern
          </button>
        </div>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Blocker eintragen</h2>
        <p className="mt-1 text-sm text-slate-500">Arbeit, Urlaub, Krankheit oder sonstige Nicht-Verfügbarkeit.</p>
        <div className="mt-4 grid gap-3">
          <CustomSelect value={normalizedBlockerProfileId} onChange={onBlockerProfileChange} disabled={!canManageAvailability || !profileOptions.length || pending} className="h-9 text-sm" options={profileSelectOptions} />
          <input
            value={blockerTitle}
            onChange={(event) => onBlockerTitleChange(event.target.value)}
            disabled={pending}
            className="h-9 rounded-md border border-slate-200 px-3 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
            placeholder="Titel"
          />
          <CustomSelect value={blockerKind} onChange={(value) => onBlockerKindChange(value as AvailabilityEntry["blockerKind"])} disabled={pending} className="h-9 text-sm" options={blockerKindOptions} aria-label="Art des Blockers" />
          <div className="grid grid-cols-2 gap-2">
            <CustomDatePicker value={blockerStartDate} onChange={onBlockerStartDateChange} disabled={pending} className="h-9 text-sm" aria-label="Blocker Startdatum" />
            <CustomDatePicker value={blockerEndDate} onChange={onBlockerEndDateChange} disabled={pending} className="h-9 text-sm" aria-label="Blocker Enddatum" />
          </div>
          <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={blockerAllDay} onChange={(event) => onBlockerAllDayChange(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Ganztägig blockieren
          </label>
          <div className="grid grid-cols-2 gap-2">
            <CustomSelect value={blockerStartTime} onChange={onBlockerStartTimeChange} disabled={pending || blockerAllDay} className="h-9 text-sm" options={timeOptions} aria-label="Blocker Startzeit" />
            <CustomSelect value={blockerEndTime} onChange={onBlockerEndTimeChange} disabled={pending || blockerAllDay} className="h-9 text-sm" options={timeOptions} aria-label="Blocker Endzeit" />
          </div>
          <textarea value={blockerNote} onChange={(event) => onBlockerNoteChange(event.target.value)} placeholder="Notiz / Kontext, optional" className="min-h-20 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
          <button type="button" onClick={onAddBlocker} disabled={pending || !normalizedBlockerProfileId || !blockerTitle.trim() || (!blockerAllDay && timeToMinutes(blockerStartTime) >= timeToMinutes(blockerEndTime))} className="h-9 rounded-md bg-amber-600 px-3 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50">
            Blocker speichern
          </button>
        </div>
      </section>
    </>
  );
}
