"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AvailabilityEntry, PlanningData, Profile } from "@/lib/types";
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
import { buildMeetingFinderViewModel } from "@/features/meetings/model/meeting-finder-view-model";

type CalendarDragState = {
  entry: AvailabilityEntry;
  duration: number;
  originalDate: string;
  originalStart: number;
  targetDate: string;
  targetStart: number;
  moved: boolean;
};

export function useMeetingFinderControls({
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
}: {
  data: PlanningData;
  today: string;
  defaultEnd: string;
  selectableProfiles: Profile[];
  editableProfiles: Profile[];
  defaultSelectedProfileIds: string[];
  currentProfile: Profile | null;
  canCreateMeeting: boolean;
  canEditAvailabilityEntry: (entry: AvailabilityEntry) => boolean;
  setCalendarSelection: (selection: { date: string; anchorStart: number; start: number; end: number } | null) => void;
  onCreateMeeting: (payload: { title: string; agenda: string; sprintId: string; meetingAt: string; durationMinutes: number; profileIds: string[] }) => void;
  onUpdateAvailability: (entry: AvailabilityEntry, patch: Partial<Omit<AvailabilityEntry, "id" | "source" | "externalId" | "externalCalendarId" | "syncedAt">>) => void;
}) {
  const defaultSelectionAppliedRef = useRef(false);
  const suppressBlockClickRef = useRef(false);
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(defaultEnd);
  const [calendarWeekStart, setCalendarWeekStart] = useState(() => startOfWeekKey(today));
  const [calendarView, setCalendarView] = useState<"week" | "month">("week");
  const [duration, setDuration] = useState("60");
  const [customDuration, setCustomDuration] = useState("120");
  const [searchStartTime, setSearchStartTime] = useState("07:00");
  const [searchEndTime, setSearchEndTime] = useState("22:00");
  const [calendarDrag, setCalendarDrag] = useState<CalendarDragState | null>(null);
  const [meetingTitle, setMeetingTitle] = useState("findmydoc Teammeeting");
  const [meetingAgenda, setMeetingAgenda] = useState("Sprint-Update, Blocker, Entscheidungen und nächste Schritte.");

  const viewModel = buildMeetingFinderViewModel({
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
      const lastVisibleMinute = (viewModel.calendarHours.at(-1) || 21 * 60) + 60;
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
    data.sprints.find((sprint) => sprint.startDate <= slot.date && sprint.endDate >= slot.date) || viewModel.activeSprint;

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
    profileNameById: viewModel.profileNameById,
  });

  const calendarBlocksForDate = (date: string) => buildCalendarBlocksForDate({
    date,
    hours: viewModel.calendarHours,
    meetings: data.meetings,
    availability: data.availability,
    selectedProfileIds,
    profileById: viewModel.profileById,
    profileNameById: viewModel.profileNameById,
  });

  const calendarDragPreview = calendarDrag
    ? {
        date: calendarDrag.targetDate,
        start: calendarDrag.targetStart,
        end: calendarDrag.targetStart + calendarDrag.duration,
        entry: calendarDrag.entry,
        label: availabilityCalendarLabel(calendarDrag.entry),
        color: profileColor(viewModel.profileById.get(calendarDrag.entry.profileId)),
      }
    : null;

  useEffect(() => {
    if (!calendarDrag) return;
    const handleMouseUp = () => finishCalendarBlockDrag();
    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [calendarDrag, finishCalendarBlockDrag]);

  const calendarDaySummary = (date: string) => {
    return summarizeCalendarDay(viewModel.calendarHours, (hour) => calendarCellFor(date, hour));
  };

  const moveCalendar = (direction: -1 | 1) => {
    setCalendarWeekStart((current) => calendarView === "week" ? addDaysKey(current, direction * 7) : addMonthsToWeekKey(current, direction));
  };

  const goToToday = () => {
    setCalendarWeekStart(startOfWeekKey(today));
  };

  const selectCurrentProfile = () => {
    if (currentProfile?.id) setSelectedProfileIds([currentProfile.id]);
  };

  const selectAllProfiles = () => {
    setSelectedProfileIds(selectableProfiles.map((profile) => profile.id));
  };

  const openAvailabilityBlock = (entry: AvailabilityEntry, openAvailabilityEditDialog: (entry: AvailabilityEntry) => void) => {
    if (suppressBlockClickRef.current) {
      suppressBlockClickRef.current = false;
      return;
    }
    openAvailabilityEditDialog(entry);
  };

  return {
    calendarBlocksForDate,
    calendarCellFor,
    calendarDaySummary,
    calendarDrag,
    calendarDragPreview,
    calendarView,
    customDuration,
    duration,
    fromDate,
    goToToday,
    meetingAgenda,
    meetingTitle,
    moveCalendar,
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
    beginCalendarBlockDrag,
    finishCalendarBlockDrag,
    moveCalendarBlockDrag,
    viewModel,
  };
}
