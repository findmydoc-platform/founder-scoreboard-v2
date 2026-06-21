import { MeetingAvailabilitySummarySection } from "@/features/meetings/molecules/meeting-availability-summary-section";
import { MeetingAvailabilityForms } from "@/features/meetings/molecules/meeting-availability-forms";
import { PlannedMeetingsSection } from "@/features/meetings/organisms/planned-meetings-section";
import type { AvailabilityEntry, Meeting, PlanningData } from "@/lib/types";

type SelectOption = { value: string; label: string };

export function MeetingAvailabilityManagement({
  data,
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
  plannedMeetings,
  profileNameById,
  calendarDates,
  workingHours,
  blockers,
  currentProfileId,
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
  onUpdateMeeting,
  onDeleteAvailability,
}: {
  data: PlanningData;
  normalizedWorkProfileId: string;
  normalizedBlockerProfileId: string;
  profileOptions: SelectOption[];
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
  plannedMeetings: Meeting[];
  profileNameById: Map<string, string>;
  calendarDates: string[];
  workingHours: AvailabilityEntry[];
  blockers: AvailabilityEntry[];
  currentProfileId?: string;
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
  onUpdateMeeting: (meeting: Meeting, patch: Partial<Pick<Meeting, "title" | "agenda" | "meetingAt" | "status">>) => void;
  onDeleteAvailability: (entry: AvailabilityEntry) => void;
}) {
  return (
    <>
      <MeetingAvailabilityForms
        normalizedWorkProfileId={normalizedWorkProfileId}
        normalizedBlockerProfileId={normalizedBlockerProfileId}
        profileOptions={profileOptions}
        canManageAvailability={canManageAvailability}
        pending={pending}
        workWeekdays={workWeekdays}
        workStart={workStart}
        workEnd={workEnd}
        blockerTitle={blockerTitle}
        blockerKind={blockerKind}
        blockerStartDate={blockerStartDate}
        blockerEndDate={blockerEndDate}
        blockerAllDay={blockerAllDay}
        blockerStartTime={blockerStartTime}
        blockerEndTime={blockerEndTime}
        blockerNote={blockerNote}
        onWorkProfileChange={onWorkProfileChange}
        onBlockerProfileChange={onBlockerProfileChange}
        onWorkWeekdaysChange={onWorkWeekdaysChange}
        onToggleWorkWeekday={onToggleWorkWeekday}
        onWorkStartChange={onWorkStartChange}
        onWorkEndChange={onWorkEndChange}
        onBlockerTitleChange={onBlockerTitleChange}
        onBlockerKindChange={onBlockerKindChange}
        onBlockerStartDateChange={onBlockerStartDateChange}
        onBlockerEndDateChange={onBlockerEndDateChange}
        onBlockerAllDayChange={onBlockerAllDayChange}
        onBlockerStartTimeChange={onBlockerStartTimeChange}
        onBlockerEndTimeChange={onBlockerEndTimeChange}
        onBlockerNoteChange={onBlockerNoteChange}
        onAddWorkingHours={onAddWorkingHours}
        onAddBlocker={onAddBlocker}
      />
      <PlannedMeetingsSection
        plannedMeetings={plannedMeetings}
        sprints={data.sprints}
        meetingAttendance={data.meetingAttendance}
        profileNameById={profileNameById}
        canManageAvailability={canManageAvailability}
        pending={pending}
        onUpdateMeeting={onUpdateMeeting}
      />
      <MeetingAvailabilitySummarySection
        availability={data.availability}
        calendarDates={calendarDates}
        workingHours={workingHours}
        blockers={blockers}
        profileNameById={profileNameById}
        canManageAvailability={canManageAvailability}
        currentProfileId={currentProfileId}
        pending={pending}
        onDeleteAvailability={onDeleteAvailability}
      />
    </>
  );
}
