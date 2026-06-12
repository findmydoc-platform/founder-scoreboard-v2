"use client";

import { useState } from "react";
import {
  availabilityTypeForBlockerKind,
  blockerKindForAvailability,
  minutesToTime,
  timeToMinutes,
} from "@/lib/meeting-finder";
import type { AvailabilityEntry, Profile } from "@/lib/types";

export function useMeetingAvailabilityEditor({
  today,
  editableProfiles,
  defaultEditableProfileId,
  canManageAvailability,
  currentProfileId,
  onCreateAvailability,
  onUpdateAvailability,
  onDeleteAvailability,
}: {
  today: string;
  editableProfiles: Profile[];
  defaultEditableProfileId: string;
  canManageAvailability: boolean;
  currentProfileId?: string;
  onCreateAvailability: (entry: Omit<AvailabilityEntry, "id">) => void;
  onUpdateAvailability: (entry: AvailabilityEntry, patch: Partial<Omit<AvailabilityEntry, "id" | "source" | "externalId" | "externalCalendarId" | "syncedAt">>) => void;
  onDeleteAvailability: (entry: AvailabilityEntry) => void;
}) {
  const [workProfileId, setWorkProfileId] = useState(defaultEditableProfileId);
  const [workWeekdays, setWorkWeekdays] = useState<string[]>(["1", "2", "3", "4", "5"]);
  const [workStart, setWorkStart] = useState("09:00");
  const [workEnd, setWorkEnd] = useState("18:00");
  const [blockerProfileId, setBlockerProfileId] = useState(defaultEditableProfileId);
  const [blockerTitle, setBlockerTitle] = useState("");
  const [blockerKind, setBlockerKind] = useState<AvailabilityEntry["blockerKind"]>("on_business");
  const [blockerStartDate, setBlockerStartDate] = useState(today);
  const [blockerEndDate, setBlockerEndDate] = useState(today);
  const [blockerStartTime, setBlockerStartTime] = useState("09:00");
  const [blockerEndTime, setBlockerEndTime] = useState("18:00");
  const [blockerAllDay, setBlockerAllDay] = useState(false);
  const [blockerNote, setBlockerNote] = useState("");
  const [availabilityDialogMode, setAvailabilityDialogMode] = useState<"create" | "edit" | null>(null);
  const [editingAvailability, setEditingAvailability] = useState<AvailabilityEntry | null>(null);
  const [calendarSelection, setCalendarSelection] = useState<{ date: string; anchorStart: number; start: number; end: number } | null>(null);

  const normalizedWorkProfileId = editableProfiles.some((profile) => profile.id === workProfileId) ? workProfileId : defaultEditableProfileId;
  const normalizedBlockerProfileId = editableProfiles.some((profile) => profile.id === blockerProfileId) ? blockerProfileId : defaultEditableProfileId;

  const addWorkingHours = () => {
    if (!normalizedWorkProfileId || !workWeekdays.length) return;
    for (const weekday of workWeekdays) {
      onCreateAvailability({
        profileId: normalizedWorkProfileId,
        type: "working_hours",
        title: "Reguläre FindMyDoc-Arbeitszeit",
        blockerKind: "working_hours",
        weekday: Number(weekday),
        startDate: "",
        endDate: "",
        startTime: workStart,
        endTime: workEnd,
        note: "Reguläre FindMyDoc-Arbeitszeit",
      });
    }
  };

  const toggleWorkWeekday = (weekday: string) => {
    setWorkWeekdays((current) =>
      current.includes(weekday) ? current.filter((item) => item !== weekday) : [...current, weekday].sort(),
    );
  };

  const addBlocker = () => {
    if (!normalizedBlockerProfileId || !blockerTitle.trim()) return;
    onCreateAvailability({
      profileId: normalizedBlockerProfileId,
      type: availabilityTypeForBlockerKind(blockerKind),
      title: blockerTitle.trim(),
      blockerKind,
      weekday: null,
      startDate: blockerStartDate,
      endDate: blockerEndDate || blockerStartDate,
      startTime: blockerAllDay ? "00:00" : blockerStartTime,
      endTime: blockerAllDay ? "23:59" : blockerEndTime,
      note: blockerNote.trim(),
    });
    setBlockerTitle("");
    setBlockerNote("");
  };

  const canEditAvailabilityEntry = (entry: AvailabilityEntry) =>
    entry.source !== "google_calendar" && (canManageAvailability || entry.profileId === currentProfileId);

  const openAvailabilityCreateDialog = (date: string, start: number, end: number) => {
    if (!normalizedBlockerProfileId) return;
    setEditingAvailability(null);
    setAvailabilityDialogMode("create");
    setBlockerProfileId(normalizedBlockerProfileId);
    setBlockerTitle("");
    setBlockerKind("on_business");
    setBlockerStartDate(date);
    setBlockerEndDate(date);
    setBlockerStartTime(minutesToTime(start));
    setBlockerEndTime(minutesToTime(end));
    setBlockerAllDay(false);
    setBlockerNote("");
  };

  const openAvailabilityEditDialog = (entry: AvailabilityEntry) => {
    if (!canEditAvailabilityEntry(entry)) return;
    setEditingAvailability(entry);
    setAvailabilityDialogMode("edit");
    setBlockerProfileId(entry.profileId);
    setBlockerTitle(entry.title || "");
    setBlockerKind(blockerKindForAvailability(entry));
    setBlockerStartDate(entry.startDate || today);
    setBlockerEndDate(entry.endDate || entry.startDate || today);
    setBlockerStartTime(entry.startTime || "09:00");
    setBlockerEndTime(entry.endTime || "18:00");
    setBlockerAllDay(entry.startTime === "00:00" && (entry.endTime === "23:59" || entry.endTime === "24:00"));
    setBlockerNote(entry.note || "");
  };

  const closeAvailabilityDialog = () => {
    setAvailabilityDialogMode(null);
    setEditingAvailability(null);
    setCalendarSelection(null);
  };

  const saveAvailabilityDialog = () => {
    const patch = {
      profileId: normalizedBlockerProfileId,
      type: availabilityTypeForBlockerKind(blockerKind),
      title: blockerTitle.trim(),
      blockerKind,
      weekday: null,
      startDate: blockerStartDate,
      endDate: blockerEndDate || blockerStartDate,
      startTime: blockerAllDay ? "00:00" : blockerStartTime,
      endTime: blockerAllDay ? "23:59" : blockerEndTime,
      note: blockerNote.trim(),
    };
    if (!patch.profileId || !patch.title || (!blockerAllDay && timeToMinutes(blockerStartTime) >= timeToMinutes(blockerEndTime))) return;
    if (availabilityDialogMode === "edit" && editingAvailability) {
      onUpdateAvailability(editingAvailability, patch);
    } else {
      onCreateAvailability(patch);
    }
    closeAvailabilityDialog();
    setBlockerTitle("");
    setBlockerNote("");
  };

  const deleteAvailabilityDialogEntry = () => {
    if (!editingAvailability) return;
    onDeleteAvailability(editingAvailability);
    closeAvailabilityDialog();
  };

  const beginCalendarSelection = (date: string, start: number) => {
    if (!normalizedBlockerProfileId) return;
    setCalendarSelection({ date, anchorStart: start, start, end: start + 60 });
  };

  const extendCalendarSelection = (date: string, start: number) => {
    setCalendarSelection((current) => {
      if (!current || current.date !== date) return current;
      return {
        ...current,
        start: Math.min(current.anchorStart, start),
        end: Math.max(current.anchorStart + 60, start + 60),
      };
    });
  };

  const finishCalendarSelection = () => {
    if (!calendarSelection) return;
    openAvailabilityCreateDialog(calendarSelection.date, calendarSelection.start, calendarSelection.end);
    setCalendarSelection(null);
  };

  return {
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
  };
}
