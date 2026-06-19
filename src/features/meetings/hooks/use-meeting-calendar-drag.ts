"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  availabilityCalendarLabel,
  minutesToTime,
  profileColor,
} from "@/features/meetings/model/meeting-finder";
import type { AvailabilityEntry, Profile } from "@/lib/types";

type CalendarDragState = {
  entry: AvailabilityEntry;
  duration: number;
  originalDate: string;
  originalStart: number;
  targetDate: string;
  targetStart: number;
  moved: boolean;
};

type CalendarSelection = {
  date: string;
  anchorStart: number;
  start: number;
  end: number;
} | null;

type UseMeetingCalendarDragOptions = {
  calendarHours: number[];
  canEditAvailabilityEntry: (entry: AvailabilityEntry) => boolean;
  profileById: Map<string, Profile>;
  setCalendarSelection: (selection: CalendarSelection) => void;
  onUpdateAvailability: (entry: AvailabilityEntry, patch: Partial<Omit<AvailabilityEntry, "id" | "source" | "externalId" | "externalCalendarId" | "syncedAt">>) => void;
};

export function useMeetingCalendarDrag({
  calendarHours,
  canEditAvailabilityEntry,
  profileById,
  setCalendarSelection,
  onUpdateAvailability,
}: UseMeetingCalendarDragOptions) {
  const suppressBlockClickRef = useRef(false);
  const [calendarDrag, setCalendarDrag] = useState<CalendarDragState | null>(null);

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

  const openAvailabilityBlock = (entry: AvailabilityEntry, openAvailabilityEditDialog: (entry: AvailabilityEntry) => void) => {
    if (suppressBlockClickRef.current) {
      suppressBlockClickRef.current = false;
      return;
    }
    openAvailabilityEditDialog(entry);
  };

  return {
    beginCalendarBlockDrag,
    calendarDrag,
    calendarDragPreview,
    finishCalendarBlockDrag,
    moveCalendarBlockDrag,
    openAvailabilityBlock,
  };
}
