"use client";

import { CalendarDays, ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { eventDateRangeLabel, founderEventCategoryLabel } from "@/lib/founder-events";
import type { HeaderCalendarEvent, HeaderDataSlot } from "@/lib/types";
import { classNames, UiBadge, UiEmptyState } from "@/shared/atoms/ui-primitives";

const weekdayLabels = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function firstOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(date);
}

function fullDateLabel(dateKey: string) {
  const date = parseDateKey(dateKey);
  if (!date) return dateKey;
  return new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "long" }).format(date);
}

function getMonthDays(viewMonth: Date) {
  const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = addDays(first, -mondayOffset);
  return Array.from({ length: 42 }, (_, index) => addDays(start, index));
}

function eventStartMs(event: HeaderCalendarEvent) {
  const time = new Date(event.startsAt).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function eventDayKeys(event: HeaderCalendarEvent) {
  const start = new Date(event.startsAt);
  if (Number.isNaN(start.getTime())) return [];
  const end = new Date(event.endsAt || event.startsAt);
  const startDate = parseDateKey(toDateKey(start));
  const endDate = parseDateKey(toDateKey(Number.isNaN(end.getTime()) ? start : end));
  if (!startDate || !endDate) return [];
  const last = endDate < startDate ? startDate : endDate;
  const keys: string[] = [];
  for (let day = startDate; day <= last; day = addDays(day, 1)) {
    keys.push(toDateKey(day));
  }
  return keys;
}

function markerTone(event: HeaderCalendarEvent, dayKey: string, todayKey: string) {
  if (event.status === "cancelled") return "bg-slate-300";
  if (event.status === "done" || dayKey < todayKey) return "bg-slate-400";
  return "bg-blue-500";
}

function eventStatusTone(event: HeaderCalendarEvent) {
  if (event.status === "cancelled") return "slate";
  if (event.status === "done") return "emerald";
  return "blue";
}

function eventStatusLabel(event: HeaderCalendarEvent) {
  if (event.status === "cancelled") return "Abgesagt";
  if (event.status === "done") return "Erledigt";
  return "Geplant";
}

function buildEventsByDay(events: HeaderCalendarEvent[]) {
  const map = new Map<string, HeaderCalendarEvent[]>();
  for (const event of events) {
    for (const key of eventDayKeys(event)) {
      const eventsForDay = map.get(key) || [];
      eventsForDay.push(event);
      map.set(key, eventsForDay);
    }
  }
  for (const [key, eventsForDay] of map) {
    map.set(key, [...eventsForDay].sort((left, right) => eventStartMs(left) - eventStartMs(right)));
  }
  return map;
}

function upcomingEvents(events: HeaderCalendarEvent[]) {
  const now = Date.now();
  return [...events]
    .filter((event) => event.status !== "cancelled" && eventStartMs(event) >= now)
    .sort((left, right) => eventStartMs(left) - eventStartMs(right))
    .slice(0, 3);
}

function EventRow({ event }: { event: HeaderCalendarEvent }) {
  return (
    <article className="rounded-md border border-slate-100 bg-white px-3 py-2">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-slate-950">{event.title}</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">{eventDateRangeLabel(event)}</p>
          {event.location && (
            <p className="mt-1 inline-flex min-w-0 items-center gap-1 text-xs text-slate-500">
              <MapPin size={12} className="shrink-0" />
              <span className="truncate">{event.location}</span>
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <UiBadge tone={eventStatusTone(event)} size="xs">{eventStatusLabel(event)}</UiBadge>
          <span className="text-[11px] font-semibold text-slate-400">{founderEventCategoryLabel(event.category)}</span>
        </div>
      </div>
    </article>
  );
}

export function HeaderEventCalendar({ events: eventSlot }: { events: HeaderDataSlot<HeaderCalendarEvent[]> }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const today = useMemo(() => new Date(), []);
  const todayKey = toDateKey(today);
  const [open, setOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState(todayKey);
  const [viewMonth, setViewMonth] = useState(() => firstOfMonth(today));
  const events = eventSlot.data;
  const days = useMemo(() => getMonthDays(viewMonth), [viewMonth]);
  const eventsByDay = useMemo(() => buildEventsByDay(events), [events]);
  const selectedEvents = eventsByDay.get(selectedKey) || [];
  const nextEvents = useMemo(() => upcomingEvents(events), [events]);
  const todayEventCount = eventsByDay.get(todayKey)?.length || 0;

  useEffect(() => {
    if (!open) return;

    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    window.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const selectDay = (date: Date) => {
    setSelectedKey(toDateKey(date));
    setViewMonth(firstOfMonth(date));
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="relative grid h-9 w-9 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
        aria-label="Kalender öffnen"
      >
        <CalendarDays size={16} />
        {todayEventCount > 0 && (
          <span className="absolute -right-1 -top-1 grid min-h-5 min-w-5 place-items-center rounded-full bg-blue-600 px-1 text-[11px] font-semibold text-white">
            {todayEventCount > 9 ? "9+" : todayEventCount}
          </span>
        )}
      </button>

      {open && (
        <section className="fixed inset-x-4 top-20 z-50 max-h-[calc(100dvh-6rem)] overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl shadow-slate-900/15 sm:absolute sm:inset-x-auto sm:right-0 sm:top-11 sm:w-[min(94vw,390px)]" role="dialog" aria-label="Kalender">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
            <button
              type="button"
              onClick={() => setViewMonth((current) => addMonths(current, -1))}
              className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-white"
              aria-label="Vorheriger Monat"
            >
              <ChevronLeft size={17} />
            </button>
            <h2 className="text-base font-semibold text-slate-950">{monthLabel(viewMonth)}</h2>
            <button
              type="button"
              onClick={() => setViewMonth((current) => addMonths(current, 1))}
              className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-white"
              aria-label="Nächster Monat"
            >
              <ChevronRight size={17} />
            </button>
          </div>

          <div className="max-h-[calc(100dvh-10rem)] overflow-y-auto">
            {eventSlot.state === "loading" ? (
              <div className="p-4">
                <UiEmptyState tone="muted" className="px-3 py-8">
                  Kalenderdaten werden geladen.
                </UiEmptyState>
              </div>
            ) : eventSlot.state === "error" ? (
              <div className="p-4">
                <UiEmptyState tone="muted" className="px-3 py-8">
                  {eventSlot.error || "Kalenderdaten konnten nicht geladen werden."}
                </UiEmptyState>
              </div>
            ) : (
              <>
            <div className="px-4 py-3">
              <div className="grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-500">
                {weekdayLabels.map((label) => <div key={label}>{label}</div>)}
              </div>
              <div className="mt-1 grid grid-cols-7 gap-1">
                {days.map((day) => {
                  const key = toDateKey(day);
                  const selected = key === selectedKey;
                  const currentMonth = day.getMonth() === viewMonth.getMonth();
                  const todaySelected = key === todayKey;
                  const dayEvents = eventsByDay.get(key) || [];
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => selectDay(day)}
                      aria-pressed={selected}
                      aria-current={todaySelected ? "date" : undefined}
                      className={classNames(
                        "grid h-10 place-items-center rounded-lg text-sm transition",
                        selected ? "bg-blue-600 font-semibold text-white" : todaySelected ? "bg-blue-50 font-semibold text-blue-700" : currentMonth ? "text-slate-800 hover:bg-white" : "text-slate-400 hover:bg-white",
                      )}
                    >
                      <span>{day.getDate()}</span>
                      <span className="mt-0.5 flex h-1.5 items-center justify-center gap-0.5">
                        {dayEvents.slice(0, 3).map((event) => (
                          <span
                            key={`${key}-${event.id}`}
                            className={classNames("h-1.5 w-1.5 rounded-full", selected ? "bg-white" : markerTone(event, key, todayKey))}
                          />
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-slate-200 px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold text-slate-950">{selectedKey === todayKey ? "Heute" : fullDateLabel(selectedKey)}</h3>
                <button type="button" onClick={() => selectDay(today)} className="text-xs font-semibold text-blue-700 hover:text-blue-800">
                  Heute
                </button>
              </div>
              <div className="mt-2 grid gap-2">
                {selectedEvents.length ? selectedEvents.map((event) => <EventRow key={event.id} event={event} />) : (
                  <UiEmptyState tone="muted" className="px-3 py-4">
                    Keine Events.
                  </UiEmptyState>
                )}
              </div>
            </div>

            <div className="border-t border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-950">Nächste Events</h3>
              <div className="mt-2 grid gap-2">
                {nextEvents.length ? nextEvents.map((event) => <EventRow key={event.id} event={event} />) : (
                  <UiEmptyState tone="muted" className="px-3 py-4">
                    Keine bevorstehenden Events.
                  </UiEmptyState>
                )}
              </div>
            </div>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
