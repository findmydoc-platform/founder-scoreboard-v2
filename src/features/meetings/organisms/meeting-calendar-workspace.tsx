import { MeetingAvailabilityDialog } from "@/features/meetings/organisms/meeting-availability-dialog";
import { MeetingCalendarMonthView } from "@/features/meetings/organisms/meeting-calendar-month-view";
import { MeetingCalendarToolbar } from "@/features/meetings/molecules/meeting-calendar-toolbar";
import { MeetingCalendarWeekView } from "@/features/meetings/organisms/meeting-calendar-week-view";
import type { CalendarBlock, CalendarCell } from "@/features/meetings/model/meeting-finder";
import type { AvailabilityEntry, Profile } from "@/lib/types";

type SelectOption = { value: string; label: string };
type CalendarSelection = { date: string; start: number; end: number };
type CalendarDrag = {
  entry: AvailabilityEntry;
  duration: number;
  originalDate: string;
  originalStart: number;
  targetDate: string;
  targetStart: number;
  moved: boolean;
} | null;
type CalendarDragPreview = {
  date: string;
  start: number;
  end: number;
  label: string;
  color: string;
} | null;
type CalendarDaySummary = {
  open: number;
  blocked: number;
  meetings: number;
  closed: number;
};

export function MeetingCalendarWorkspace({
  calendarView,
  calendarTitle,
  calendarSubtitle,
  currentProfile,
  selectableProfiles,
  selectedProfileIds,
  today,
  calendarDates,
  calendarHours,
  calendarSelection,
  calendarDrag,
  calendarDragPreview,
  calendarMonthDates,
  calendarActiveMonth,
  workingHoursCount,
  availabilityDialogMode,
  editingAvailability,
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
  availabilityDialogSaveDisabled,
  calendarCellFor,
  calendarBlocksForDate,
  canEditAvailabilityEntry,
  calendarDaySummary,
  onToday,
  onMoveCalendar,
  onCalendarViewChange,
  onSelectCurrentProfile,
  onSelectAllProfiles,
  onToggleParticipant,
  onBeginCalendarSelection,
  onExtendCalendarSelection,
  onFinishCalendarSelection,
  onMoveCalendarBlockDrag,
  onFinishCalendarBlockDrag,
  onBeginCalendarBlockDrag,
  onCalendarBlockClick,
  onCloseAvailabilityDialog,
  onDeleteAvailabilityDialogEntry,
  onSaveAvailabilityDialog,
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
  calendarView: "week" | "month";
  calendarTitle: string;
  calendarSubtitle: string;
  currentProfile: Profile | null;
  selectableProfiles: Profile[];
  selectedProfileIds: string[];
  today: string;
  calendarDates: string[];
  calendarHours: number[];
  calendarSelection: CalendarSelection | null;
  calendarDrag: CalendarDrag;
  calendarDragPreview: CalendarDragPreview;
  calendarMonthDates: string[];
  calendarActiveMonth: number;
  workingHoursCount: number;
  availabilityDialogMode: "create" | "edit" | null;
  editingAvailability: AvailabilityEntry | null;
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
  availabilityDialogSaveDisabled: boolean;
  calendarCellFor: (date: string, start: number) => CalendarCell;
  calendarBlocksForDate: (date: string) => CalendarBlock[];
  canEditAvailabilityEntry: (entry: AvailabilityEntry) => boolean;
  calendarDaySummary: (date: string) => CalendarDaySummary;
  onToday: () => void;
  onMoveCalendar: (direction: -1 | 1) => void;
  onCalendarViewChange: (view: "week" | "month") => void;
  onSelectCurrentProfile: () => void;
  onSelectAllProfiles: () => void;
  onToggleParticipant: (profileId: string) => void;
  onBeginCalendarSelection: (date: string, start: number) => void;
  onExtendCalendarSelection: (date: string, start: number) => void;
  onFinishCalendarSelection: () => void;
  onMoveCalendarBlockDrag: (date: string, start: number) => void;
  onFinishCalendarBlockDrag: () => void;
  onBeginCalendarBlockDrag: (entry: AvailabilityEntry, date: string, start: number, end: number) => void;
  onCalendarBlockClick: (entry: AvailabilityEntry) => void;
  onCloseAvailabilityDialog: () => void;
  onDeleteAvailabilityDialogEntry: () => void;
  onSaveAvailabilityDialog: () => void;
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
    <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
      <MeetingCalendarToolbar
        calendarView={calendarView}
        calendarTitle={calendarTitle}
        calendarSubtitle={calendarSubtitle}
        currentProfile={currentProfile}
        selectableProfiles={selectableProfiles}
        selectedProfileIds={selectedProfileIds}
        onToday={onToday}
        onMoveCalendar={onMoveCalendar}
        onCalendarViewChange={onCalendarViewChange}
        onSelectCurrentProfile={onSelectCurrentProfile}
        onSelectAllProfiles={onSelectAllProfiles}
        onToggleParticipant={onToggleParticipant}
      />
      {calendarView === "week" ? (
        <MeetingCalendarWeekView
          dates={calendarDates}
          hours={calendarHours}
          calendarSelection={calendarSelection}
          calendarDrag={calendarDrag}
          calendarDragPreview={calendarDragPreview}
          calendarCellFor={calendarCellFor}
          calendarBlocksForDate={calendarBlocksForDate}
          canEditAvailabilityEntry={canEditAvailabilityEntry}
          onBeginCalendarSelection={onBeginCalendarSelection}
          onExtendCalendarSelection={onExtendCalendarSelection}
          onFinishCalendarSelection={onFinishCalendarSelection}
          onMoveCalendarBlockDrag={onMoveCalendarBlockDrag}
          onFinishCalendarBlockDrag={onFinishCalendarBlockDrag}
          onBeginCalendarBlockDrag={onBeginCalendarBlockDrag}
          onCalendarBlockClick={onCalendarBlockClick}
        />
      ) : (
        <MeetingCalendarMonthView
          dates={calendarMonthDates}
          activeMonth={calendarActiveMonth}
          today={today}
          daySummary={calendarDaySummary}
        />
      )}
      {!workingHoursCount && (
        <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
          Noch keine Arbeitszeiten hinterlegt. Trage unten pro Person reguläre findmydoc-Zeiten ein oder nutze „Mo-Fr auswählen“. Erst dann kann das Raster echte freie Zeiten zeigen.
        </div>
      )}
      {availabilityDialogMode && (
        <MeetingAvailabilityDialog
          mode={availabilityDialogMode}
          hasEditingAvailability={Boolean(editingAvailability)}
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
          saveDisabled={availabilityDialogSaveDisabled}
          onClose={onCloseAvailabilityDialog}
          onDelete={onDeleteAvailabilityDialogEntry}
          onSave={onSaveAvailabilityDialog}
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
      )}
    </section>
  );
}
