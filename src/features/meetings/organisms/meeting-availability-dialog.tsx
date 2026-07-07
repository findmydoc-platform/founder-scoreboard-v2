import { X } from "lucide-react";
import { MeetingBlockerFormFields } from "@/features/meetings/molecules/meeting-blocker-form-fields";
import { UiButton } from "@/shared/atoms/ui-primitives";
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
  showProfileSelect = true,
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
  showProfileSelect?: boolean;
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
          <UiButton type="button" onClick={onClose} size="iconXs" className="text-slate-500" aria-label="Dialog schließen">
            <X className="h-4 w-4" />
          </UiButton>
        </div>
        <div className="mt-4 grid gap-3">
          <MeetingBlockerFormFields
            normalizedBlockerProfileId={normalizedBlockerProfileId}
            profileOptions={profileOptions}
            canManageAvailability={canManageAvailability}
            pending={pending}
            blockerTitle={blockerTitle}
            blockerKind={blockerKind}
            blockerStartDate={blockerStartDate}
            blockerEndDate={blockerEndDate}
            blockerAllDay={blockerAllDay}
            blockerStartTime={blockerStartTime}
            blockerEndTime={blockerEndTime}
            blockerNote={blockerNote}
            showProfileSelect={showProfileSelect}
            profileAriaLabel="Profil wählen"
            titlePlaceholder="Titel, z. B. Kundentermin, Fokuszeit, Urlaub"
            titleAriaLabel="Blocker-Titel"
            kindAriaLabel="Art des Blockers wählen"
            startDateAriaLabel="Startdatum wählen"
            endDateAriaLabel="Enddatum wählen"
            startTimeAriaLabel="Startzeit wählen"
            endTimeAriaLabel="Endzeit wählen"
            titleInputProps={{ inputPadding: "md" }}
            noteTextAreaProps={{ minHeight: "lg", inputPadding: "mdBlock", textTone: "muted" }}
            onBlockerProfileChange={onBlockerProfileChange}
            onBlockerTitleChange={onBlockerTitleChange}
            onBlockerKindChange={onBlockerKindChange}
            onBlockerStartDateChange={onBlockerStartDateChange}
            onBlockerEndDateChange={onBlockerEndDateChange}
            onBlockerAllDayChange={onBlockerAllDayChange}
            onBlockerStartTimeChange={onBlockerStartTimeChange}
            onBlockerEndTimeChange={onBlockerEndTimeChange}
            onBlockerNoteChange={onBlockerNoteChange}
          />
        </div>
        <div className="mt-4 flex flex-wrap justify-between gap-2">
          <div>
            {mode === "edit" && hasEditingAvailability && (
              <UiButton type="button" onClick={onDelete} disabled={pending} variant="red">
                Löschen
              </UiButton>
            )}
          </div>
          <div className="flex gap-2">
            <UiButton type="button" onClick={onClose}>
              Abbrechen
            </UiButton>
            <UiButton type="button" onClick={onSave} disabled={saveDisabled} variant="primary">
              {mode === "edit" ? "Änderungen speichern" : "Blocker speichern"}
            </UiButton>
          </div>
        </div>
      </div>
    </div>
  );
}
