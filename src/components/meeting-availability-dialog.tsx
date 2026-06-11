import { X } from "lucide-react";
import { CustomDatePicker } from "@/components/custom-date-picker";
import { CustomSelect } from "@/components/custom-select";
import { blockerKindOptions, timeOptions } from "@/lib/meeting-finder";
import type { AvailabilityEntry } from "@/lib/types";

type SelectOption = { value: string; label: string };

export function MeetingAvailabilityDialog({
  mode,
  hasEditingAvailability,
  normalizedBlockerProfileId,
  profileOptions,
  canManageAvailability,
  pending,
  blockerTitle,
  blockerKind,
  blockerStartDate,
  blockerEndDate,
  blockerAllDay,
  blockerStartTime,
  blockerEndTime,
  blockerNote,
  saveDisabled,
  onClose,
  onDelete,
  onSave,
  onBlockerProfileChange,
  onBlockerTitleChange,
  onBlockerKindChange,
  onBlockerStartDateChange,
  onBlockerEndDateChange,
  onBlockerAllDayChange,
  onBlockerStartTimeChange,
  onBlockerEndTimeChange,
  onBlockerNoteChange,
}: {
  mode: "create" | "edit";
  hasEditingAvailability: boolean;
  normalizedBlockerProfileId: string;
  profileOptions: SelectOption[];
  canManageAvailability: boolean;
  pending: boolean;
  blockerTitle: string;
  blockerKind: AvailabilityEntry["blockerKind"];
  blockerStartDate: string;
  blockerEndDate: string;
  blockerAllDay: boolean;
  blockerStartTime: string;
  blockerEndTime: string;
  blockerNote: string;
  saveDisabled: boolean;
  onClose: () => void;
  onDelete: () => void;
  onSave: () => void;
  onBlockerProfileChange: (profileId: string) => void;
  onBlockerTitleChange: (title: string) => void;
  onBlockerKindChange: (kind: AvailabilityEntry["blockerKind"]) => void;
  onBlockerStartDateChange: (date: string) => void;
  onBlockerEndDateChange: (date: string) => void;
  onBlockerAllDayChange: (allDay: boolean) => void;
  onBlockerStartTimeChange: (time: string) => void;
  onBlockerEndTimeChange: (time: string) => void;
  onBlockerNoteChange: (note: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/35 px-4 py-6" role="dialog" aria-modal="true" aria-label={mode === "edit" ? "Blocker bearbeiten" : "Blocker anlegen"}>
      <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-4 shadow-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold text-slate-950">{mode === "edit" ? "Blocker bearbeiten" : "Blocker anlegen"}</h3>
            <p className="mt-1 text-sm text-slate-500">Direkt aus der Kalenderansicht. Zeiten und Typ können nachträglich angepasst werden.</p>
          </div>
          <button type="button" onClick={onClose} className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="Dialog schließen">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-4 grid gap-3">
          <CustomSelect value={normalizedBlockerProfileId} onChange={onBlockerProfileChange} disabled={!canManageAvailability || !profileOptions.length || pending} className="h-9 text-sm" options={profileOptions.length ? profileOptions : [{ value: "", label: "Kein Profil" }]} aria-label="Profil wählen" />
          <input
            value={blockerTitle}
            onChange={(event) => onBlockerTitleChange(event.target.value)}
            disabled={pending}
            className="h-9 rounded-md border border-slate-200 px-3 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
            placeholder="Titel, z. B. Kundentermin, Fokuszeit, Urlaub"
            aria-label="Blocker-Titel"
          />
          <CustomSelect value={blockerKind} onChange={(value) => onBlockerKindChange(value as AvailabilityEntry["blockerKind"])} disabled={pending} className="h-9 text-sm" options={blockerKindOptions} aria-label="Art des Blockers wählen" />
          <div className="grid grid-cols-2 gap-2">
            <CustomDatePicker value={blockerStartDate} onChange={onBlockerStartDateChange} disabled={pending} className="h-9 text-sm" aria-label="Startdatum wählen" />
            <CustomDatePicker value={blockerEndDate} onChange={onBlockerEndDateChange} disabled={pending} className="h-9 text-sm" aria-label="Enddatum wählen" />
          </div>
          <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={blockerAllDay} onChange={(event) => onBlockerAllDayChange(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Ganztägig blockieren
          </label>
          <div className="grid grid-cols-2 gap-2">
            <CustomSelect value={blockerStartTime} onChange={onBlockerStartTimeChange} disabled={pending || blockerAllDay} className="h-9 text-sm" options={timeOptions} aria-label="Startzeit wählen" />
            <CustomSelect value={blockerEndTime} onChange={onBlockerEndTimeChange} disabled={pending || blockerAllDay} className="h-9 text-sm" options={timeOptions} aria-label="Endzeit wählen" />
          </div>
          <textarea
            value={blockerNote}
            onChange={(event) => onBlockerNoteChange(event.target.value)}
            placeholder="Notiz / Kontext, optional"
            className="min-h-24 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
        </div>
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <div>
            {mode === "edit" && hasEditingAvailability && (
              <button type="button" onClick={onDelete} disabled={pending} className="h-9 rounded-md border border-red-200 bg-white px-3 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50">
                Löschen
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
              Abbrechen
            </button>
            <button type="button" onClick={onSave} disabled={saveDisabled} className="h-9 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
              {mode === "edit" ? "Änderungen speichern" : "Blocker speichern"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
