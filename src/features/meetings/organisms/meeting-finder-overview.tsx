"use client";

import { MeetingAvailabilityManagement } from "@/features/meetings/organisms/meeting-availability-management";
import { MeetingCalendarWorkspace } from "@/features/meetings/organisms/meeting-calendar-workspace";
import { MeetingSlotSearchSection } from "@/features/meetings/organisms/meeting-slot-search-section";
import { useMeetingAvailabilityEditor } from "@/features/meetings/hooks/use-meeting-availability-editor";
import { useMeetingFinderControls } from "@/features/meetings/hooks/use-meeting-finder-controls";
import type { AvailabilityEntry, Meeting, PlanningData, Profile } from "@/lib/types";

import {
  timeToMinutes,
} from "@/features/meetings/model/meeting-finder";
import { buildMeetingFinderDefaults } from "@/features/meetings/model/meeting-finder-view-model";

export function MeetingFinderOverview({
  data,
  pending,
  currentProfile,
  canManageAvailability,
  canCreateMeeting,
  calendarSyncMessage,
  meetingCreateMessage,
  onCreateAvailability,
  onUpdateAvailability,
  onDeleteAvailability,
  onSyncGoogleCalendar,
  onCreateMeeting,
  onUpdateMeeting,
}: {
  data: PlanningData;
  pending: boolean;
  currentProfile: Profile | null;
  canManageAvailability: boolean;
  canCreateMeeting: boolean;
  calendarSyncMessage: string;
  meetingCreateMessage: string;
  onCreateAvailability: (entry: Omit<AvailabilityEntry, "id">) => void;
  onUpdateAvailability: (entry: AvailabilityEntry, patch: Partial<Omit<AvailabilityEntry, "id" | "source" | "externalId" | "externalCalendarId" | "syncedAt">>) => void;
  onDeleteAvailability: (entry: AvailabilityEntry) => void;
  onSyncGoogleCalendar: () => void;
  onCreateMeeting: (payload: { title: string; agenda: string; sprintId: string; meetingAt: string; durationMinutes: number; profileIds: string[] }) => void;
  onUpdateMeeting: (meeting: Meeting, patch: Partial<Pick<Meeting, "title" | "agenda" | "meetingAt" | "status">>) => void;
}) {
  const {
    today,
    defaultEnd,
    selectableProfiles,
    editableProfiles,
    defaultEditableProfileId,
    defaultSelectedProfileIds,
  } = buildMeetingFinderDefaults({ data, currentProfile, canManageAvailability });
  const {
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
    availabilityDialogMode,
    editingAvailability,
    calendarSelection,
    normalizedWorkProfileId,
    normalizedBlockerProfileId,
    setCalendarSelection,
    setWorkProfileId,
    setWorkWeekdays,
    setWorkStart,
    setWorkEnd,
    setBlockerProfileId,
    setBlockerTitle,
    setBlockerKind,
    setBlockerStartDate,
    setBlockerEndDate,
    setBlockerAllDay,
    setBlockerStartTime,
    setBlockerEndTime,
    setBlockerNote,
    addWorkingHours,
    toggleWorkWeekday,
    addBlocker,
    canEditAvailabilityEntry,
    closeAvailabilityDialog,
    saveAvailabilityDialog,
    deleteAvailabilityDialogEntry,
    beginCalendarSelection,
    extendCalendarSelection,
    finishCalendarSelection,
    openAvailabilityEditDialog,
  } = useMeetingAvailabilityEditor({
    today,
    editableProfiles,
    defaultEditableProfileId,
    canManageAvailability,
    currentProfileId: currentProfile?.id,
    onCreateAvailability,
    onUpdateAvailability,
    onDeleteAvailability,
  });

  const {
    beginCalendarBlockDrag,
    calendarBlocksForDate,
    calendarCellFor,
    calendarDaySummary,
    calendarDrag,
    calendarDragPreview,
    calendarView,
    customDuration,
    duration,
    finishCalendarBlockDrag,
    fromDate,
    goToToday,
    meetingAgenda,
    meetingTitle,
    moveCalendar,
    moveCalendarBlockDrag,
    openAvailabilityBlock,
    reserveSlot,
    searchEndTime,
    searchStartTime,
    selectAllProfiles,
    selectCurrentProfile,
    selectedProfileIds,
    setCalendarView,
    setCustomDuration,
    setDuration,
    setFromDate,
    setMeetingAgenda,
    setMeetingTitle,
    setSearchEndTime,
    setSearchStartTime,
    setSelectedProfileIds,
    setToDate,
    toDate,
    toggleParticipant,
    viewModel,
  } = useMeetingFinderControls({
    data,
    today,
    defaultEnd,
    selectableProfiles,
    editableProfiles,
    defaultSelectedProfileIds,
    currentProfile,
    canCreateMeeting,
    canEditAvailabilityEntry,
    setCalendarSelection,
    onCreateMeeting,
    onUpdateAvailability,
  });
  const {
    workingHours,
    blockers,
    googleCalendarProfiles,
    lastGoogleSync,
    profileNameById,
    searchStartMinutes,
    searchEndMinutes,
    slots,
    calendarDates,
    calendarTitle,
    calendarSubtitle,
    calendarMonthDates,
    calendarActiveMonth,
    calendarHours,
    canReserveMeetingSlot,
    plannedMeetings,
    profileOptions,
  } = viewModel;

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,430px)_minmax(0,1fr)]">
      <MeetingSlotSearchSection
        workingHoursCount={workingHours.length}
        blockersCount={blockers.length}
        slots={slots}
        selectedProfileIds={selectedProfileIds}
        selectableProfiles={selectableProfiles}
        googleCalendarProfiles={googleCalendarProfiles}
        lastGoogleSync={lastGoogleSync}
        calendarSyncMessage={calendarSyncMessage}
        pending={pending}
        canManageAvailability={canManageAvailability}
        canReserveMeetingSlot={canReserveMeetingSlot}
        fromDate={fromDate}
        toDate={toDate}
        duration={duration}
        customDuration={customDuration}
        searchStartTime={searchStartTime}
        searchEndTime={searchEndTime}
        searchStartMinutes={searchStartMinutes}
        searchEndMinutes={searchEndMinutes}
        meetingTitle={meetingTitle}
        meetingAgenda={meetingAgenda}
        meetingCreateMessage={meetingCreateMessage}
        profileNameById={profileNameById}
        onSyncGoogleCalendar={onSyncGoogleCalendar}
        onFromDateChange={setFromDate}
        onToDateChange={setToDate}
        onDurationChange={setDuration}
        onCustomDurationChange={setCustomDuration}
        onSearchStartTimeChange={setSearchStartTime}
        onSearchEndTimeChange={setSearchEndTime}
        onMeetingTitleChange={setMeetingTitle}
        onMeetingAgendaChange={setMeetingAgenda}
        onSelectedProfileIdsChange={setSelectedProfileIds}
        onToggleParticipant={toggleParticipant}
        onReserveSlot={reserveSlot}
      />
      <MeetingCalendarWorkspace
        calendarView={calendarView}
        calendarTitle={calendarTitle}
        calendarSubtitle={calendarSubtitle}
        currentProfile={currentProfile}
        selectableProfiles={selectableProfiles}
        selectedProfileIds={selectedProfileIds}
        today={today}
        calendarDates={calendarDates}
        calendarHours={calendarHours}
        calendarSelection={calendarSelection}
        calendarDrag={calendarDrag}
        calendarDragPreview={calendarDragPreview}
        calendarMonthDates={calendarMonthDates}
        calendarActiveMonth={calendarActiveMonth}
        workingHoursCount={workingHours.length}
        availabilityDialogMode={availabilityDialogMode}
        editingAvailability={editingAvailability}
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
        availabilityDialogSaveDisabled={pending || !normalizedBlockerProfileId || !blockerTitle.trim() || (!blockerAllDay && timeToMinutes(blockerStartTime) >= timeToMinutes(blockerEndTime))}
        calendarCellFor={calendarCellFor}
        calendarBlocksForDate={calendarBlocksForDate}
        canEditAvailabilityEntry={canEditAvailabilityEntry}
        calendarDaySummary={calendarDaySummary}
        onToday={goToToday}
        onMoveCalendar={moveCalendar}
        onCalendarViewChange={setCalendarView}
        onSelectCurrentProfile={selectCurrentProfile}
        onSelectAllProfiles={selectAllProfiles}
        onToggleParticipant={toggleParticipant}
        onBeginCalendarSelection={beginCalendarSelection}
        onExtendCalendarSelection={extendCalendarSelection}
        onFinishCalendarSelection={finishCalendarSelection}
        onMoveCalendarBlockDrag={moveCalendarBlockDrag}
        onFinishCalendarBlockDrag={finishCalendarBlockDrag}
        onBeginCalendarBlockDrag={beginCalendarBlockDrag}
        onCalendarBlockClick={(entry) => openAvailabilityBlock(entry, openAvailabilityEditDialog)}
        onCloseAvailabilityDialog={closeAvailabilityDialog}
        onDeleteAvailabilityDialogEntry={deleteAvailabilityDialogEntry}
        onSaveAvailabilityDialog={saveAvailabilityDialog}
        onBlockerProfileChange={setBlockerProfileId}
        onBlockerTitleChange={setBlockerTitle}
        onBlockerKindChange={setBlockerKind}
        onBlockerStartDateChange={setBlockerStartDate}
        onBlockerEndDateChange={setBlockerEndDate}
        onBlockerAllDayChange={setBlockerAllDay}
        onBlockerStartTimeChange={setBlockerStartTime}
        onBlockerEndTimeChange={setBlockerEndTime}
        onBlockerNoteChange={setBlockerNote}
      />
      <MeetingAvailabilityManagement
        data={data}
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
        plannedMeetings={plannedMeetings}
        profileNameById={profileNameById}
        calendarDates={calendarDates}
        workingHours={workingHours}
        blockers={blockers}
        currentProfileId={currentProfile?.id}
        onWorkProfileChange={setWorkProfileId}
        onBlockerProfileChange={setBlockerProfileId}
        onWorkWeekdaysChange={setWorkWeekdays}
        onToggleWorkWeekday={toggleWorkWeekday}
        onWorkStartChange={setWorkStart}
        onWorkEndChange={setWorkEnd}
        onBlockerTitleChange={setBlockerTitle}
        onBlockerKindChange={setBlockerKind}
        onBlockerStartDateChange={setBlockerStartDate}
        onBlockerEndDateChange={setBlockerEndDate}
        onBlockerAllDayChange={setBlockerAllDay}
        onBlockerStartTimeChange={setBlockerStartTime}
        onBlockerEndTimeChange={setBlockerEndTime}
        onBlockerNoteChange={setBlockerNote}
        onAddWorkingHours={addWorkingHours}
        onAddBlocker={addBlocker}
        onUpdateMeeting={onUpdateMeeting}
        onDeleteAvailability={onDeleteAvailability}
      />
    </div>
  );
}
