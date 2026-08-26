"use client";

import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  UsersRound,
  X,
} from "lucide-react";
import { useId, useMemo, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import {
  addCalendarDays,
  addCalendarMonths,
  berlinDateKey,
  calendarGridForMonth,
  eventsByCalendarDay,
  firstCalendarDayOfMonth,
  projectCalendarWorktimes,
  weekdayForDate,
  type CalendarTeamWorkweek,
} from "@/features/team-workweek/model/team-workweek-calendar";
import type { PublishedTeamWorkweek } from "@/features/team-workweek/model/published-team-workweek";
import { starterTeamProfiles } from "@/features/team-workweek/model/team-workweek-matrix";
import { TeamWorkweekMatrix } from "@/features/team-workweek/molecules/team-workweek-matrix";
import type { HeaderCalendarEvent, HeaderDataSlot, Profile } from "@/lib/types";
import { classNames, UiBadge, UiButton, UiEmptyState, UiNotice } from "@/shared/atoms/ui-primitives";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";

const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function monthLabel(monthKey: string) {
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(`${monthKey}T00:00:00.000Z`));
}

function fullDateLabel(dateKey: string) {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${dateKey}T00:00:00.000Z`));
}

function eventTimeRangeLabel(event: HeaderCalendarEvent) {
  const formatter = new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
  const start = formatter.format(new Date(event.startsAt));
  if (!event.endsAt || event.endsAt === event.startsAt) return start;
  return `${start}–${formatter.format(new Date(event.endsAt))}`;
}

function EventRow({ event }: { event: HeaderCalendarEvent }) {
  return (
    <article className="rounded-lg border border-slate-200 bg-white px-3 py-3">
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-blue-600" aria-hidden="true" />
          <h4 className="truncate text-sm font-semibold text-slate-950">{event.title}</h4>
        </div>
        <time className="shrink-0 text-xs font-medium text-slate-500">{eventTimeRangeLabel(event)}</time>
      </div>
    </article>
  );
}

export function HeaderCalendarDialog({
  activeTab,
  anchor,
  calendarWorkweeks,
  desktopPopover,
  eventSlot,
  message,
  now,
  onActiveTabChange,
  onClose,
  onOpenTeam,
  onSelectedDateChange,
  onViewMonthChange,
  pending,
  profiles,
  restoreFocusRef,
  selectedDate,
  showWorkweek,
  viewMonth,
  workweeks,
}: {
  activeTab: "events" | "workweek";
  anchor: Readonly<{ right: number; top: number }> | null;
  calendarWorkweeks: CalendarTeamWorkweek[];
  desktopPopover: boolean;
  eventSlot: HeaderDataSlot<HeaderCalendarEvent[]>;
  message: string;
  now: Date;
  onActiveTabChange: (tab: "events" | "workweek") => void;
  onClose: () => void;
  onOpenTeam: () => void;
  onSelectedDateChange: (dateKey: string) => void;
  onViewMonthChange: (monthKey: string) => void;
  pending: boolean;
  profiles: Profile[];
  restoreFocusRef: RefObject<HTMLButtonElement | null>;
  selectedDate: string;
  showWorkweek: boolean;
  viewMonth: string;
  workweeks: PublishedTeamWorkweek[];
}) {
  const dialogRef = useModalDialog<HTMLDivElement>({
    open: true,
    onClose,
    manageEnvironment: !desktopPopover,
    restoreFocusRef,
  });
  const tabId = useId();
  const todayKey = berlinDateKey(now);
  const starterProfiles = useMemo(() => starterTeamProfiles(profiles), [profiles]);
  const days = useMemo(() => calendarGridForMonth(viewMonth), [viewMonth]);
  const eventsByDay = useMemo(() => eventsByCalendarDay(eventSlot.data), [eventSlot.data]);
  const selectedEvents = eventsByDay.get(selectedDate) || [];
  const selectedWorktimes = projectCalendarWorktimes({
    calendarWorkweeks,
    dateKey: selectedDate,
    now,
    profiles: starterProfiles,
  });
  const anchorStyle = anchor ? {
    "--header-calendar-right": `${anchor.right}px`,
    "--header-calendar-top": `${anchor.top}px`,
  } as CSSProperties : undefined;

  const selectDate = (dateKey: string, focus = false) => {
    onSelectedDateChange(dateKey);
    if (!dateKey.startsWith(viewMonth.slice(0, 7))) onViewMonthChange(firstCalendarDayOfMonth(dateKey));
    if (focus) window.requestAnimationFrame(() => document.getElementById(`header-calendar-day-${dateKey}`)?.focus());
  };

  const handleCalendarKeyDown = (event: KeyboardEvent<HTMLButtonElement>, dateKey: string) => {
    const weekday = weekdayForDate(dateKey).weekday;
    const nextDate = event.key === "ArrowRight"
      ? addCalendarDays(dateKey, 1)
      : event.key === "ArrowLeft"
        ? addCalendarDays(dateKey, -1)
        : event.key === "ArrowDown"
          ? addCalendarDays(dateKey, 7)
          : event.key === "ArrowUp"
            ? addCalendarDays(dateKey, -7)
            : event.key === "Home"
              ? addCalendarDays(dateKey, 1 - weekday)
              : event.key === "End"
                ? addCalendarDays(dateKey, 7 - weekday)
                : event.key === "PageUp"
                  ? addCalendarMonths(dateKey, -1)
                  : event.key === "PageDown"
                    ? addCalendarMonths(dateKey, 1)
                    : null;
    if (!nextDate) return;
    event.preventDefault();
    selectDate(nextDate, true);
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!showWorkweek || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextTab = event.key === "Home"
      ? "events"
      : event.key === "End"
        ? "workweek"
        : activeTab === "events"
          ? "workweek"
          : "events";
    onActiveTabChange(nextTab);
    window.requestAnimationFrame(() => document.getElementById(`${tabId}-${nextTab}`)?.focus());
  };

  const changeMonth = (amount: number) => {
    const nextMonth = addCalendarMonths(viewMonth, amount);
    onViewMonthChange(nextMonth);
    onSelectedDateChange(nextMonth);
  };

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal={desktopPopover ? undefined : "true"}
      aria-labelledby="header-calendar-title"
      className="fixed inset-0 z-[60] flex items-stretch justify-center"
    >
      <button type="button" tabIndex={-1} aria-label="Kalender schließen" className="absolute inset-0 cursor-default bg-slate-950/30 backdrop-blur-[1px] lg:bg-transparent lg:backdrop-blur-none" onClick={onClose} />
      <section
        style={anchorStyle}
        className={classNames(
          "relative z-10 flex h-dvh max-h-dvh min-h-0 w-full flex-col overflow-hidden bg-slate-50 shadow-2xl lg:fixed lg:right-[var(--header-calendar-right)] lg:top-[var(--header-calendar-top)] lg:h-auto lg:max-h-[calc(100dvh-var(--header-calendar-top)-0.75rem)] lg:w-[min(900px,calc(100vw-3rem))] lg:rounded-xl lg:border lg:border-slate-200",
          !anchor && "lg:invisible",
        )}
      >
        <span className="absolute -top-2 right-2.5 hidden h-4 w-4 rotate-45 border-l border-t border-slate-200 bg-white lg:block" aria-hidden="true" />
        <header className="shrink-0 border-b border-slate-200 bg-white px-4 pt-[max(0.75rem,env(safe-area-inset-top))] sm:px-5 lg:pt-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-700" aria-hidden="true"><CalendarDays size={17} /></span>
              <div className="min-w-0">
                <h2 id="header-calendar-title" className="text-base font-semibold text-slate-950">Kalender</h2>
                <p className="text-xs text-slate-500">FounderOps · Europe/Berlin</p>
              </div>
            </div>
            <UiButton data-autofocus size="iconLg" variant="secondary" aria-label="Kalender schließen" onClick={onClose}><X size={18} /></UiButton>
          </div>
          {showWorkweek ? (
            <div className="mt-2 flex min-h-11 items-end gap-6" role="tablist" aria-label="Kalenderansicht">
              {(["events", "workweek"] as const).map((tab) => {
                const selected = activeTab === tab;
                return (
                  <button
                    key={tab}
                    id={`${tabId}-${tab}`}
                    type="button"
                    role="tab"
                    aria-controls={`${tabId}-${tab}-panel`}
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => onActiveTabChange(tab)}
                    onKeyDown={handleTabKeyDown}
                    className={classNames(
                      "min-h-11 border-b-2 px-0.5 text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-blue-500",
                      selected ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800",
                    )}
                  >
                    {tab === "events" ? "Termine" : "Arbeitswoche"}
                  </button>
                );
              })}
            </div>
          ) : null}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {activeTab === "events" || !showWorkweek ? (
            <div id={`${tabId}-events-panel`} role={showWorkweek ? "tabpanel" : undefined} aria-labelledby={showWorkweek ? `${tabId}-events` : undefined} className="grid min-h-full gap-4 p-3 sm:p-5 lg:grid-cols-[minmax(320px,0.92fr)_minmax(360px,1.08fr)]">
              <section className="h-fit rounded-lg border border-slate-200 bg-white p-3 sm:p-4" aria-label="Monatskalender">
                <div className="flex min-h-11 items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold capitalize text-slate-950">{monthLabel(viewMonth)}</h3>
                  <div className="flex items-center gap-1">
                    <UiButton size="iconLg" variant="ghost" aria-label="Vorheriger Monat" onClick={() => changeMonth(-1)}><ChevronLeft size={18} /></UiButton>
                    <UiButton size="iconLg" variant="ghost" aria-label="Nächster Monat" onClick={() => changeMonth(1)}><ChevronRight size={18} /></UiButton>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-7 text-center text-xs font-semibold text-slate-500" aria-hidden="true">
                  {WEEKDAY_LABELS.map((label) => <span key={label} className="py-2">{label}</span>)}
                </div>
                <div className="grid grid-cols-7" aria-label={monthLabel(viewMonth)}>
                  {days.map((dateKey) => {
                    const selected = dateKey === selectedDate;
                    const today = dateKey === todayKey;
                    const currentMonth = dateKey.startsWith(viewMonth.slice(0, 7));
                    const dayEvents = eventsByDay.get(dateKey) || [];
                    const worktimes = projectCalendarWorktimes({ calendarWorkweeks, dateKey, now, profiles: starterProfiles });
                    const details = [
                      dayEvents.length ? `${dayEvents.length} Termin${dayEvents.length === 1 ? "" : "e"}` : "keine Termine",
                      showWorkweek ? `${worktimes.length} eingeplant` : null,
                    ].filter(Boolean).join(", ");
                    return (
                      <button
                        key={dateKey}
                        id={`header-calendar-day-${dateKey}`}
                        type="button"
                        tabIndex={selected ? 0 : -1}
                        aria-pressed={selected}
                        aria-current={today ? "date" : undefined}
                        aria-label={`${fullDateLabel(dateKey)}, ${details}`}
                        onClick={() => selectDate(dateKey)}
                        onKeyDown={(event) => handleCalendarKeyDown(event, dateKey)}
                        className={classNames(
                          "group grid min-h-11 min-w-0 place-items-center rounded-lg px-0.5 py-1 text-sm outline-none transition focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-blue-500",
                          selected ? "bg-blue-600 font-semibold text-white" : today ? "bg-blue-50 font-semibold text-blue-700" : currentMonth ? "text-slate-800 hover:bg-slate-50" : "text-slate-400 hover:bg-slate-50",
                        )}
                      >
                        <span>{Number(dateKey.slice(-2))}</span>
                        <span className="flex min-h-3 items-center justify-center gap-1 text-[9px] leading-none" aria-hidden="true">
                          {dayEvents.length ? <span className={classNames("h-1.5 w-1.5 rounded-full", selected ? "bg-white" : "bg-blue-500")} /> : null}
                          {showWorkweek && worktimes.length ? (
                            <span className={classNames("inline-flex items-center gap-0.5", selected ? "text-white" : "text-slate-400")}>
                              <UsersRound size={9} strokeWidth={2.2} />{worktimes.length}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-3 sm:p-4" aria-label={`Details für ${fullDateLabel(selectedDate)}`}>
                <div className="flex min-h-11 items-center justify-between gap-3 border-b border-slate-100 pb-3">
                  <h3 className="text-sm font-semibold text-slate-950">{selectedDate === todayKey ? "Heute" : fullDateLabel(selectedDate)}</h3>
                  <button type="button" onClick={() => selectDate(todayKey)} className="min-h-11 rounded-md px-2 text-xs font-semibold text-blue-700 outline-none hover:bg-blue-50 focus-visible:ring-2 focus-visible:ring-blue-500">Heute</button>
                </div>

                <div className="mt-4">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Termine</h4>
                  {eventSlot.state === "error" ? <UiNotice className="mt-2" tone="warning" size="xs">{eventSlot.error || "Kalenderdaten konnten nicht geladen werden."}{eventSlot.data.length ? " Bereits geladene Termine bleiben sichtbar." : ""}</UiNotice> : null}
                  {eventSlot.state === "loading" && !eventSlot.data.length ? <UiEmptyState className="mt-2 px-3 py-4" tone="muted">Termine werden geladen.</UiEmptyState> : null}
                  <div className="mt-2 grid gap-2">
                    {selectedEvents.length ? selectedEvents.map((event) => <EventRow key={event.id} event={event} />) : eventSlot.state !== "loading" ? <UiEmptyState className="px-3 py-4" tone="muted">Keine FounderOps-Termine.</UiEmptyState> : null}
                  </div>
                </div>

                {showWorkweek ? (
                  <div className="mt-5 border-t border-slate-100 pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Arbeitszeiten</h4>
                      <span className="text-xs text-slate-400">laut Regelwoche</span>
                    </div>
                    {message ? <UiNotice className="mt-2" tone="warning" size="xs">{calendarWorkweeks.length ? "Aktualisierung verzögert. Zuletzt bestätigte Arbeitszeiten bleiben sichtbar." : message}</UiNotice> : null}
                    {pending && !calendarWorkweeks.length ? <UiEmptyState className="mt-2 px-3 py-4" tone="muted">Arbeitszeiten werden geladen.</UiEmptyState> : null}
                    <div className="mt-2 grid gap-2">
                      {selectedWorktimes.map(({ profile, windows, workingNow }) => (
                        <article key={profile.id} className="flex min-w-0 items-start justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2.5">
                          <div className="flex min-w-0 items-center gap-2.5">
                            <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: profile.color || "#64748b" }} aria-hidden="true" />
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-slate-950">{profile.name}</p>
                              <p className="mt-0.5 text-xs text-slate-500">{windows.map((window) => `${window.start}–${window.end}`).join(" · ")}</p>
                            </div>
                          </div>
                          {workingNow ? <UiBadge className="shrink-0 gap-1" tone="emerald" size="xs"><Clock3 size={12} aria-hidden="true" />Jetzt</UiBadge> : null}
                        </article>
                      ))}
                      {!selectedWorktimes.length && !pending ? <UiEmptyState className="px-3 py-4" tone="muted">Niemand eingeplant.</UiEmptyState> : null}
                    </div>
                  </div>
                ) : null}
              </section>
            </div>
          ) : (
            <div id={`${tabId}-workweek-panel`} role="tabpanel" aria-labelledby={`${tabId}-workweek`} className="p-2.5 sm:p-4">
              <p className="sr-only" role="status" aria-live="polite">{pending ? "Team-Arbeitswoche wird aktualisiert." : message || "Team-Arbeitswoche wurde geladen."}</p>
              {message ? <UiNotice className="mb-3" tone="warning" size="xs">{workweeks.length ? "Aktualisierung verzögert. Zuletzt bestätigte Grundwochen bleiben sichtbar." : message}</UiNotice> : null}
              {pending && !workweeks.length ? <UiEmptyState className="min-h-48" tone="muted">Team-Arbeitswoche wird geladen.</UiEmptyState> : <TeamWorkweekMatrix compact profiles={profiles} workweeks={workweeks} />}
            </div>
          )}
        </div>

        <footer className="flex shrink-0 justify-start border-t border-slate-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
          <UiButton className="min-h-11 w-full justify-center text-blue-700 sm:w-auto sm:justify-start" variant="ghost" onClick={onOpenTeam}>Im Team öffnen</UiButton>
        </footer>
      </section>
    </div>
  );
}
