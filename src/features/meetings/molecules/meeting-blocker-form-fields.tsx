import type { ComponentProps } from "react";
import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { blockerKindOptions, timeOptions } from "@/features/meetings/model/meeting-finder";
import type { AvailabilityEntry } from "@/lib/types";
import { UiTextArea, UiTextInput } from "@/shared/atoms/ui-primitives";

type SelectOption = { value: string; label: string };

type MeetingBlockerFormFieldsProps = {
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
  profileAriaLabel?: string;
  titlePlaceholder: string;
  titleAriaLabel?: string;
  kindAriaLabel: string;
  startDateAriaLabel: string;
  endDateAriaLabel: string;
  startTimeAriaLabel: string;
  endTimeAriaLabel: string;
  titleInputProps?: Pick<ComponentProps<typeof UiTextInput>, "className" | "inputPadding">;
  noteTextAreaProps?: Pick<ComponentProps<typeof UiTextArea>, "className" | "minHeight" | "inputPadding" | "textTone">;
  onBlockerProfileChange: (value: string) => void;
  onBlockerTitleChange: (value: string) => void;
  onBlockerKindChange: (value: AvailabilityEntry["blockerKind"]) => void;
  onBlockerStartDateChange: (value: string) => void;
  onBlockerEndDateChange: (value: string) => void;
  onBlockerAllDayChange: (value: boolean) => void;
  onBlockerStartTimeChange: (value: string) => void;
  onBlockerEndTimeChange: (value: string) => void;
  onBlockerNoteChange: (value: string) => void;
};

export function MeetingBlockerFormFields({
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
  profileAriaLabel,
  titlePlaceholder,
  titleAriaLabel,
  kindAriaLabel,
  startDateAriaLabel,
  endDateAriaLabel,
  startTimeAriaLabel,
  endTimeAriaLabel,
  titleInputProps,
  noteTextAreaProps,
  onBlockerProfileChange,
  onBlockerTitleChange,
  onBlockerKindChange,
  onBlockerStartDateChange,
  onBlockerEndDateChange,
  onBlockerAllDayChange,
  onBlockerStartTimeChange,
  onBlockerEndTimeChange,
  onBlockerNoteChange,
}: MeetingBlockerFormFieldsProps) {
  return (
    <>
      <CustomSelect
        value={normalizedBlockerProfileId}
        onChange={onBlockerProfileChange}
        disabled={!canManageAvailability || !profileOptions.length || pending}
        className="h-9 text-sm"
        options={profileOptions.length ? profileOptions : [{ value: "", label: "Kein Profil" }]}
        aria-label={profileAriaLabel}
      />
      <UiTextInput
        value={blockerTitle}
        onChange={(event) => onBlockerTitleChange(event.target.value)}
        disabled={pending}
        placeholder={titlePlaceholder}
        aria-label={titleAriaLabel}
        {...titleInputProps}
      />
      <CustomSelect value={blockerKind} onChange={(value) => onBlockerKindChange(value as AvailabilityEntry["blockerKind"])} disabled={pending} className="h-9 text-sm" options={blockerKindOptions} aria-label={kindAriaLabel} />
      <div className="grid grid-cols-2 gap-2">
        <CustomDatePicker value={blockerStartDate} onChange={onBlockerStartDateChange} disabled={pending} className="h-9 text-sm" aria-label={startDateAriaLabel} />
        <CustomDatePicker value={blockerEndDate} onChange={onBlockerEndDateChange} disabled={pending} className="h-9 text-sm" aria-label={endDateAriaLabel} />
      </div>
      <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
        <input type="checkbox" checked={blockerAllDay} onChange={(event) => onBlockerAllDayChange(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
        Ganztägig blockieren
      </label>
      <div className="grid grid-cols-2 gap-2">
        <CustomSelect value={blockerStartTime} onChange={onBlockerStartTimeChange} disabled={pending || blockerAllDay} className="h-9 text-sm" options={timeOptions} aria-label={startTimeAriaLabel} />
        <CustomSelect value={blockerEndTime} onChange={onBlockerEndTimeChange} disabled={pending || blockerAllDay} className="h-9 text-sm" options={timeOptions} aria-label={endTimeAriaLabel} />
      </div>
      <UiTextArea
        value={blockerNote}
        onChange={(event) => onBlockerNoteChange(event.target.value)}
        placeholder="Notiz / Kontext, optional"
        {...noteTextAreaProps}
      />
    </>
  );
}
