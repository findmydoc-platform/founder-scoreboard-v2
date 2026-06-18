"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MeetingAvailabilityManagement } from "@/features/meetings/organisms/meeting-availability-management";
import { MeetingCalendarWorkspace } from "@/features/meetings/organisms/meeting-calendar-workspace";
import { MeetingSlotSearchSection } from "@/features/meetings/organisms/meeting-slot-search-section";
import { useMeetingAvailabilityEditor } from "@/features/meetings/hooks/use-meeting-availability-editor";
import type { AvailabilityEntry, Meeting, PlanningData, Profile } from "@/lib/types";

import {
  addDaysKey,
  addMonthsToWeekKey,
  availabilityCalendarLabel,
  buildCalendarCell,
  buildCalendarBlocksForDate,
  meetingSlotIso,
  minutesToTime,
  profileColor,
  startOfWeekKey,
  summarizeCalendarDay,
  timeToMinutes,
  type MeetingSlot,
} from "@/features/meetings/model/meeting-finder";
import { buildMeetingFinderDefaults, buildMeetingFinderViewModel } from "@/features/meetings/model/meeting-finder-view-model";

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
  const defaultSelectionAppliedRef = useRef(false);
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(defaultEnd);
  const [calendarWeekStart, setCalendarWeekStart] = useState(() => startOfWeekKey(today));
  const [calendarView, setCalendarView] = useState<"week" | "month">("week");
  const [duration, setDuration] = useState("60");
  const [customDuration, setCustomDuration] = useState("120");
  const [searchStartTime, setSearchStartTime] = useState("07:00");
  const [searchEndTime, setSearchEndTime] = useState("22:00");
  const [calendarDrag, setCalendarDrag] = useState<{
    entry: AvailabilityEntry;
    duration: number;
    originalDate: string;
    originalStart: number;
    targetDate: string;
    targetStart: number;
    moved: boolean;
  } | null>(null);
  const [meetingTitle, setMeetingTitle] = useState("findmydoc Teammeeting");
  const [meetingAgenda, setMeetingAgenda] = useState("Sprint-Update, Blocker, Entscheidungen und nächste Schritte.");
  const suppressBlockClickRef = useRef(false);
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
    workingHours,
    blockers,
    googleCalendarBlocks,
    googleCalendarProfiles,
    lastGoogleSync,
    profileNameById,
    profileById,
    searchStartMinutes,
    searchEndMinutes,
    slots,
    calendarDates,
    calendarTitle,
    calendarSubtitle,
    calendarMonthDates,
    calendarActiveMonth,
    calendarHours,
    activeSprint,
    canReserveMeetingSlot,
    plannedMeetings,
    profileOptions,
  } = buildMeetingFinderViewModel({
    data,
    selectedProfileIds,
    selectableProfiles,
    editableProfiles,
    fromDate,
    toDate,
    duration,
    customDuration,
    searchStartTime,
    searchEndTime,
    calendarWeekStart,
    calendarView,
    canCreateMeeting,
  });
  useEffect(() => {
    if (!defaultSelectionAppliedRef.current && defaultSelectedProfileIds.length) {
      setSelectedProfileIds(defaultSelectedProfileIds);
      defaultSelectionAppliedRef.current = true;
    }
  }, [defaultSelectedProfileIds]);

  const toggleParticipant = (profileId: string) => {
    setSelectedProfileIds((current) =>
      current.includes(profileId) ? current.filter((id) => id !== profileId) : [...current, profileId],
    );
  };

  const beginCalendarBlockDrag = (entry: AvailabilityEntry, date: string, start: number, end: number) => {
    if (!canEditAvailabilityEntry(entry) || entry.startDate !== entry.endDate) return false;
    suppressBlockClickRef.current = false;
    setCalendarSelection(null);
    setCalendarDrag({
      entry,
      duration: Math.max(30, end - start),
      originalDate: date,
      originalStart: start,
      targetDate: date,
      targetStart: start,
      moved: false,
    });
    return true;
  };

  const moveCalendarBlockDrag = (date: string, start: number) => {
    setCalendarDrag((current) => {
      if (!current) return current;
      const lastVisibleMinute = (calendarHours.at(-1) || 21 * 60) + 60;
      const targetStart = Math.min(start, lastVisibleMinute - current.duration);
      return {
        ...current,
        targetDate: date,
        targetStart,
        moved: current.moved || date !== current.originalDate || targetStart !== current.originalStart,
      };
    });
  };

  const finishCalendarBlockDrag = useCallback(() => {
    setCalendarDrag((current) => {
      if (!current) return null;
      if (current.moved) {
        suppressBlockClickRef.current = true;
        onUpdateAvailability(current.entry, {
          startDate: current.targetDate,
          endDate: current.targetDate,
          startTime: minutesToTime(current.targetStart),
          endTime: minutesToTime(current.targetStart + current.duration),
        });
      }
      return null;
    });
  }, [onUpdateAvailability]);

  const sprintForSlot = (slot: MeetingSlot) =>
    data.sprints.find((sprint) => sprint.startDate <= slot.date && sprint.endDate >= slot.date) || activeSprint;

  const reserveSlot = (slot: MeetingSlot) => {
    const sprint = sprintForSlot(slot);
    if (!sprint || !selectedProfileIds.length) return;
    onCreateMeeting({
      title: meetingTitle.trim() || "findmydoc Teammeeting",
      agenda: meetingAgenda.trim(),
      sprintId: sprint.id,
      meetingAt: meetingSlotIso(slot),
      durationMinutes: timeToMinutes(slot.endTime) - timeToMinutes(slot.startTime),
      profileIds: selectedProfileIds,
    });
  };

  const calendarCellFor = (date: string, start: number) => buildCalendarCell({
    date,
    start,
    meetings: data.meetings,
    availability: data.availability,
    selectedProfileIds,
    profileNameById,
  });

  const calendarBlocksForDate = (date: string) => buildCalendarBlocksForDate({
    date,
    hours: calendarHours,
    meetings: data.meetings,
    availability: data.availability,
    selectedProfileIds,
    profileById,
    profileNameById,
  });

  const calendarDragPreview = calendarDrag
    ? {
        date: calendarDrag.targetDate,
        start: calendarDrag.targetStart,
        end: calendarDrag.targetStart + calendarDrag.duration,
        entry: calendarDrag.entry,
        label: availabilityCalendarLabel(calendarDrag.entry),
        color: profileColor(profileById.get(calendarDrag.entry.profileId)),
      }
    : null;

  useEffect(() => {
    if (!calendarDrag) return;
    const handleMouseUp = () => finishCalendarBlockDrag();
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [calendarDrag, finishCalendarBlockDrag]);

  const calendarDaySummary = (date: string) => {
    return summarizeCalendarDay(calendarHours, (hour) => calendarCellFor(date, hour));
  };

  const moveCalendar = (direction: -1 | 1) => {
    setCalendarWeekStart((current) => calendarView === "week" ? addDaysKey(current, direction * 7) : addMonthsToWeekKey(current, direction));
  };

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
        onToday={() => setCalendarWeekStart(startOfWeekKey(today))}
        onMoveCalendar={moveCalendar}
        onCalendarViewChange={setCalendarView}
        onSelectCurrentProfile={() => currentProfile?.id && setSelectedProfileIds([currentProfile.id])}
        onSelectAllProfiles={() => setSelectedProfileIds(selectableProfiles.map((profile) => profile.id))}
        onToggleParticipant={toggleParticipant}
        onBeginCalendarSelection={beginCalendarSelection}
        onExtendCalendarSelection={extendCalendarSelection}
        onFinishCalendarSelection={finishCalendarSelection}
        onMoveCalendarBlockDrag={moveCalendarBlockDrag}
        onFinishCalendarBlockDrag={finishCalendarBlockDrag}
        onBeginCalendarBlockDrag={beginCalendarBlockDrag}
        onCalendarBlockClick={(entry) => {
          if (suppressBlockClickRef.current) {
            suppressBlockClickRef.current = false;
            return;
          }
          openAvailabilityEditDialog(entry);
        }}
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
        googleCalendarBlocksCount={googleCalendarBlocks.length}
        googleCalendarProfilesCount={googleCalendarProfiles.length}
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
