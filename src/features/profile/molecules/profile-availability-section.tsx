import {
  availabilityCalendarLabel,
  blockerKindForAvailability,
  blockerKindLabel,
  formatDateLabel,
  timeOptions,
  timeToMinutes,
  weekdayForDate,
  weekdayOptions,
} from "@/features/meetings/model/meeting-finder";
import type { useMeetingAvailabilityEditor } from "@/features/meetings/hooks/use-meeting-availability-editor";
import { SettingsPane, SettingsRow } from "@/features/profile/molecules/profile-settings-layout";
import type { AvailabilityEntry } from "@/lib/types";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { classNames, UiButton, UiEmptyState } from "@/shared/atoms/ui-primitives";

export function AvailabilitySettingsSection({
  availability,
  blockers,
  calendarDates,
  editor,
  pending,
  today,
  workingHours,
  onDeleteAvailability,
}: {
  availability: AvailabilityEntry[];
  blockers: AvailabilityEntry[];
  calendarDates: string[];
  editor: ReturnType<typeof useMeetingAvailabilityEditor>;
  pending: boolean;
  today: string;
  workingHours: AvailabilityEntry[];
  onDeleteAvailability: (entry: AvailabilityEntry) => void;
}) {
  const workDisabled = pending || !editor.normalizedWorkProfileId || !editor.workWeekdays.length || timeToMinutes(editor.workStart) >= timeToMinutes(editor.workEnd);

  return (
    <SettingsPane eyebrow="Verfügbarkeit" title="Verfügbarkeit" description="Erst lesen, dann bearbeiten: Arbeitszeiten und Blocker bleiben auf dein Profil begrenzt.">
      <SettingsRow label="Woche" description="Kompakte Sicht auf die nächsten sieben Tage." align="start">
        <ProfileAvailabilityWeek availability={availability} calendarDates={calendarDates} />
      </SettingsRow>
      <SettingsRow label="Arbeitszeiten" description="Regelmäßige findmydoc-Zeit für mehrere Wochentage speichern." align="start">
        <div className="grid gap-3 text-left md:min-w-96">
          <div className="flex flex-wrap gap-2">
            <UiButton onClick={() => editor.setWorkWeekdays(["1", "2", "3", "4", "5"])} size="sm">
              Mo-Fr
            </UiButton>
            <UiButton onClick={() => editor.setWorkWeekdays(["6", "0"])} size="sm">
              Wochenende
            </UiButton>
            <UiButton onClick={() => editor.setWorkWeekdays(weekdayOptions.map((item) => item.value))} size="sm">
              Alle Tage
            </UiButton>
          </div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {weekdayOptions.map((option) => (
              <button
                key={`profile-work-weekday-${option.value}`}
                type="button"
                onClick={() => editor.toggleWorkWeekday(option.value)}
                className={classNames(
                  "h-9 rounded-md border px-3 text-left text-xs font-semibold transition",
                  editor.workWeekdays.includes(option.value)
                    ? "border-blue-300 bg-blue-50 text-blue-700"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <CustomSelect value={editor.workStart} onChange={editor.setWorkStart} disabled={pending} className="h-9 text-sm" options={timeOptions} aria-label="Arbeitszeit Start" />
            <CustomSelect value={editor.workEnd} onChange={editor.setWorkEnd} disabled={pending} className="h-9 text-sm" options={timeOptions} aria-label="Arbeitszeit Ende" />
          </div>
          <UiButton onClick={editor.addWorkingHours} disabled={workDisabled} variant="primary">
            Arbeitszeiten speichern
          </UiButton>
        </div>
      </SettingsRow>
      <SettingsRow label="Einträge" description="Blocker öffnen den vorhandenen Bearbeiten-Dialog; Google-Kalender-Einträge bleiben read-only." align="start">
        <AvailabilityEntryList
          blockers={blockers}
          pending={pending}
          workingHours={workingHours}
          onCreateBlocker={() => editor.openAvailabilityCreateDialog(today, 9 * 60, 18 * 60)}
          onDeleteAvailability={onDeleteAvailability}
          onEditBlocker={editor.openAvailabilityEditDialog}
        />
      </SettingsRow>
    </SettingsPane>
  );
}

function ProfileAvailabilityWeek({ availability, calendarDates }: { availability: AvailabilityEntry[]; calendarDates: string[] }) {
  return (
    <div className="grid gap-2 md:min-w-[520px] md:grid-cols-7">
      {calendarDates.map((date) => {
        const dayEntries = availability.filter((entry) => {
          if (entry.type === "working_hours") return entry.weekday === weekdayForDate(date);
          return (!entry.startDate || entry.startDate <= date) && (!entry.endDate || entry.endDate >= date);
        });

        return (
          <div key={date} className="min-h-28 rounded-md border border-slate-200 bg-slate-50 p-2 text-left">
            <div className="text-xs font-semibold text-slate-700">{formatDateLabel(date)}</div>
            <div className="mt-2 grid gap-1">
              {dayEntries.slice(0, 3).map((entry, index) => (
                <div key={`${date}-${entry.id}-${index}`} className="rounded border border-slate-200 bg-white px-2 py-1 text-[11px] leading-4 text-slate-600">
                  <div className="truncate font-semibold text-slate-800">{availabilityCalendarLabel(entry)}</div>
                  <div>{entry.startTime}-{entry.endTime}</div>
                </div>
              ))}
              {dayEntries.length > 3 && <div className="text-[11px] font-semibold text-slate-500">+{dayEntries.length - 3} weitere</div>}
              {!dayEntries.length && <div className="rounded border border-dashed border-slate-200 px-2 py-3 text-center text-[11px] text-slate-400">frei</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AvailabilityEntryList({
  blockers,
  pending,
  workingHours,
  onCreateBlocker,
  onDeleteAvailability,
  onEditBlocker,
}: {
  blockers: AvailabilityEntry[];
  pending: boolean;
  workingHours: AvailabilityEntry[];
  onCreateBlocker: () => void;
  onDeleteAvailability: (entry: AvailabilityEntry) => void;
  onEditBlocker: (entry: AvailabilityEntry) => void;
}) {
  const entries = [...workingHours, ...blockers];

  return (
    <div className="grid gap-3 text-left md:min-w-96">
      <div className="flex justify-start">
        <UiButton onClick={onCreateBlocker} disabled={pending} variant="primary">
          Blocker hinzufügen
        </UiButton>
      </div>
      <div className="grid gap-2">
        {entries.slice(0, 12).map((entry, index) => {
          const isWorkingHours = entry.type === "working_hours";
          const label = isWorkingHours
            ? `${weekdayOptions.find((item) => item.value === String(entry.weekday))?.label || "Wochentag"} · ${entry.startTime}-${entry.endTime}`
            : `${blockerKindLabel(blockerKindForAvailability(entry))} · ${formatDateLabel(entry.startDate)} bis ${formatDateLabel(entry.endDate)} · ${entry.startTime}-${entry.endTime}`;
          const editable = entry.source !== "google_calendar";

          return (
            <div key={`${entry.id}-${entry.profileId}-${entry.type}-${entry.weekday ?? entry.startDate}-${index}`} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-semibold text-slate-900">{availabilityCalendarLabel(entry)}</div>
                <div className="mt-0.5 truncate text-xs text-slate-500">{label}{entry.note ? ` · ${entry.note}` : ""}</div>
              </div>
              <div className="flex shrink-0 gap-2">
                {!isWorkingHours && editable && (
                  <UiButton onClick={() => onEditBlocker(entry)} disabled={pending} size="xs">
                    Bearbeiten
                  </UiButton>
                )}
                {editable && (
                  <UiButton onClick={() => onDeleteAvailability(entry)} disabled={pending} size="xs" className="text-slate-600">
                    Löschen
                  </UiButton>
                )}
              </div>
            </div>
          );
        })}
        {!entries.length && (
          <UiEmptyState tone="muted" className="rounded-md border-slate-300 px-4 py-8">
            Noch keine Arbeitszeiten oder Blocker hinterlegt.
          </UiEmptyState>
        )}
      </div>
    </div>
  );
}
