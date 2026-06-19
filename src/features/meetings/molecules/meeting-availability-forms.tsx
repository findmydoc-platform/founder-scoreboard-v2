import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { blockerKindOptions, timeOptions, timeToMinutes, weekdayOptions } from "@/features/meetings/model/meeting-finder";
import type { AvailabilityEntry } from "@/lib/types";
import { UiButton, UiPanel, UiTextArea, UiTextInput } from "@/shared/atoms/ui-primitives";

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
      <UiPanel>
        <h2 className="text-base font-semibold text-slate-950">Arbeitszeiten pflegen</h2>
        <p className="mt-1 text-sm text-slate-500">Regelmäßige findmydoc-Zeit pro Person und mehrere Wochentage in einem Schritt.</p>
        <div className="mt-4 grid gap-3">
          <CustomSelect value={normalizedWorkProfileId} onChange={onWorkProfileChange} disabled={!canManageAvailability || !profileOptions.length || pending} className="h-9 text-sm" options={profileSelectOptions} />
          <div className="grid gap-2">
            <div className="flex flex-wrap gap-2">
              <UiButton onClick={() => onWorkWeekdaysChange(["1", "2", "3", "4", "5"])} size="sm">
                Mo-Fr auswählen
              </UiButton>
              <UiButton onClick={() => onWorkWeekdaysChange(["6", "0"])} size="sm">
                Wochenende
              </UiButton>
              <UiButton onClick={() => onWorkWeekdaysChange(["0"])} size="sm">
                Nur Sonntag
              </UiButton>
              <UiButton onClick={() => onWorkWeekdaysChange(weekdayOptions.map((item) => item.value))} size="sm">
                Alle Tage
              </UiButton>
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
          <UiButton onClick={onAddWorkingHours} disabled={pending || !normalizedWorkProfileId || !workWeekdays.length || timeToMinutes(workStart) >= timeToMinutes(workEnd)} variant="primary">
            Arbeitszeiten für {workWeekdays.length || 0} Tag{workWeekdays.length === 1 ? "" : "e"} speichern
          </UiButton>
        </div>
      </UiPanel>
      <UiPanel>
        <h2 className="text-base font-semibold text-slate-950">Blocker eintragen</h2>
        <p className="mt-1 text-sm text-slate-500">Arbeit, Urlaub, Krankheit oder sonstige Nicht-Verfügbarkeit.</p>
        <div className="mt-4 grid gap-3">
          <CustomSelect value={normalizedBlockerProfileId} onChange={onBlockerProfileChange} disabled={!canManageAvailability || !profileOptions.length || pending} className="h-9 text-sm" options={profileSelectOptions} />
          <UiTextInput
            value={blockerTitle}
            onChange={(event) => onBlockerTitleChange(event.target.value)}
            disabled={pending}
            className="px-3"
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
          <UiTextArea value={blockerNote} onChange={(event) => onBlockerNoteChange(event.target.value)} placeholder="Notiz / Kontext, optional" className="min-h-20 px-3 text-slate-800" />
          <UiButton onClick={onAddBlocker} disabled={pending || !normalizedBlockerProfileId || !blockerTitle.trim() || (!blockerAllDay && timeToMinutes(blockerStartTime) >= timeToMinutes(blockerEndTime))} variant="amberPrimary">
            Blocker speichern
          </UiButton>
        </div>
      </UiPanel>
    </>
  );
}
