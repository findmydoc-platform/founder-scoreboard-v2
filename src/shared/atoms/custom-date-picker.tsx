"use client";

import { CalendarDays, ChevronLeft, ChevronRight, Clock } from "lucide-react";
import type { KeyboardEvent } from "react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

type CustomDatePickerProps = {
  value: string;
  onChange: (value: string) => void;
  mode?: "date" | "datetime";
  disabled?: boolean;
  className?: string;
  "aria-label"?: string;
};

type MenuPosition = {
  top: number;
  left: number;
};

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

function monthLabel(date: Date) {
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(date);
}

function displayValue(value: string, mode: "date" | "datetime") {
  if (!value) return mode === "datetime" ? "Datum und Uhrzeit wählen" : "Datum wählen";
  const [datePart, timePart] = value.split("T");
  const date = parseDateKey(datePart);
  if (!date) return value;
  const formattedDate = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
  return mode === "datetime" && timePart ? `${formattedDate} ${timePart}` : formattedDate;
}

function getMonthDays(viewMonth: Date) {
  const first = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function addMonths(date: Date, months: number) {
  const targetMonth = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDayOfTargetMonth = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0).getDate();
  targetMonth.setDate(Math.min(date.getDate(), lastDayOfTargetMonth));
  return targetMonth;
}

function firstOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

export function CustomDatePicker({
  value,
  onChange,
  mode = "date",
  disabled = false,
  className = "",
  "aria-label": ariaLabel,
}: CustomDatePickerProps) {
  const dialogId = useId();
  const monthLabelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dayRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [datePart, timePart = "12:00"] = value.split("T");
  const selectedDate = parseDateKey(datePart);
  const [viewMonth, setViewMonth] = useState(() => selectedDate || new Date());
  const [focusedDate, setFocusedDate] = useState(() => selectedDate || new Date());
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const days = useMemo(() => getMonthDays(viewMonth), [viewMonth]);

  const openMenu = () => {
    if (disabled) return;
    const baseDate = selectedDate || new Date();
    setViewMonth(firstOfMonth(baseDate));
    setFocusedDate(baseDate);
    setOpen(true);
  };

  const closeMenu = (focusTrigger = false) => {
    setOpen(false);
    if (focusTrigger) requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const focusDate = (date: Date) => {
    setFocusedDate(date);
    setViewMonth(firstOfMonth(date));
  };

  useEffect(() => {
    if (!open) return;

    const updateMenuPosition = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      setMenuPosition({
        top: rect.bottom + 6,
        left: rect.left,
      });
    };

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const focusedKey = toDateKey(focusedDate);
    const focusedIndex = days.findIndex((day) => toDateKey(day) === focusedKey);
    if (focusedIndex < 0) return;
    requestAnimationFrame(() => dayRefs.current[focusedIndex]?.focus());
  }, [days, focusedDate, open]);

  useEffect(() => {
    if (!open) return;

    const closeOnOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) closeMenu();
    };

    window.addEventListener("pointerdown", closeOnOutside);
    return () => window.removeEventListener("pointerdown", closeOnOutside);
  }, [open]);

  const selectDate = (date: Date) => {
    setFocusedDate(date);
    const nextDate = toDateKey(date);
    onChange(mode === "datetime" ? `${nextDate}T${timePart}` : nextDate);
    if (mode === "date") closeMenu(true);
  };

  const changeTime = (nextTime: string) => {
    const safeDate = datePart || toDateKey(new Date());
    onChange(`${safeDate}T${nextTime}`);
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.tagName === "INPUT" && event.key !== "Escape") return;

    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      focusDate(addDays(focusedDate, 1));
      return;
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      focusDate(addDays(focusedDate, -1));
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      focusDate(addDays(focusedDate, 7));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      focusDate(addDays(focusedDate, -7));
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusDate(new Date(focusedDate.getFullYear(), focusedDate.getMonth(), 1));
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      focusDate(new Date(focusedDate.getFullYear(), focusedDate.getMonth() + 1, 0));
      return;
    }
    if (event.key === "PageDown") {
      event.preventDefault();
      focusDate(addMonths(focusedDate, 1));
      return;
    }
    if (event.key === "PageUp") {
      event.preventDefault();
      focusDate(addMonths(focusedDate, -1));
      return;
    }
    if ((event.key === "Enter" || event.key === " ") && target.dataset.dateKey) {
      event.preventDefault();
      selectDate(focusedDate);
    }
  };

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={dialogId}
        onClick={() => {
          if (open) {
            closeMenu();
            return;
          }
          openMenu();
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") closeMenu();
          if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openMenu();
          }
        }}
        className="flex h-full min-h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-2.5 text-left font-normal text-slate-800 shadow-sm outline-none transition hover:border-slate-300 hover:bg-slate-50 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400 disabled:opacity-70"
      >
        <span className="truncate">{displayValue(value, mode)}</span>
        {mode === "datetime" ? <Clock size={15} className="shrink-0 text-slate-400" /> : <CalendarDays size={15} className="shrink-0 text-slate-400" />}
      </button>

      {open && menuPosition && createPortal(
        <div
          ref={menuRef}
          id={dialogId}
          role="dialog"
          aria-modal="false"
          aria-label={ariaLabel || (mode === "datetime" ? "Datum und Uhrzeit wählen" : "Datum wählen")}
          onKeyDown={handleDialogKeyDown}
          style={{ top: menuPosition.top, left: menuPosition.left }}
          className="fixed z-[100] w-72 rounded-lg border border-slate-200 bg-white p-3 text-sm shadow-xl shadow-slate-900/10"
        >
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-50"
              onClick={() => focusDate(firstOfMonth(addMonths(viewMonth, -1)))}
              aria-label="Vorheriger Monat"
            >
              <ChevronLeft size={16} />
            </button>
            <div id={monthLabelId} className="font-semibold text-slate-900">{monthLabel(viewMonth)}</div>
            <button
              type="button"
              className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-50"
              onClick={() => focusDate(firstOfMonth(addMonths(viewMonth, 1)))}
              aria-label="Nächster Monat"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-semibold text-slate-500">
            {weekdayLabels.map((label) => <div key={label} role="columnheader">{label}</div>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1" role="grid" aria-labelledby={monthLabelId}>
            {days.map((day, index) => {
              const key = toDateKey(day);
              const selected = key === datePart;
              const focused = key === toDateKey(focusedDate);
              const today = key === toDateKey(new Date());
              const muted = day.getMonth() !== viewMonth.getMonth();
              return (
                <button
                  key={key}
                  ref={(node) => {
                    dayRefs.current[index] = node;
                  }}
                  type="button"
                  role="gridcell"
                  aria-selected={selected}
                  aria-current={today ? "date" : undefined}
                  aria-label={new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "long", year: "numeric" }).format(day)}
                  tabIndex={focused ? 0 : -1}
                  data-date-key={key}
                  onClick={() => selectDate(day)}
                  className={`grid h-8 place-items-center rounded-md text-sm transition ${
                    selected ? "bg-blue-600 font-semibold text-white" : focused ? "bg-blue-50 text-blue-700 ring-2 ring-blue-100" : muted ? "text-slate-400 hover:bg-slate-50" : "text-slate-800 hover:bg-blue-50 hover:text-blue-700"
                  }`}
                >
                  {day.getDate()}
                </button>
              );
            })}
          </div>

          {mode === "datetime" && (
            <label className="mt-3 grid gap-1 text-xs font-semibold text-slate-500">
              Uhrzeit
              <input
                type="text"
                inputMode="numeric"
                value={timePart}
                onChange={(event) => changeTime(event.target.value)}
                placeholder="12:00"
                className="h-9 rounded-md border border-slate-200 px-2 text-sm font-normal text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </label>
          )}

          <div className="mt-3 flex justify-between gap-2 border-t border-slate-100 pt-3">
            <button type="button" onClick={() => onChange("")} className="h-8 rounded-md px-2 text-xs font-semibold text-slate-500 hover:bg-slate-50">Löschen</button>
            <button type="button" onClick={() => selectDate(new Date())} className="h-8 rounded-md px-2 text-xs font-semibold text-blue-700 hover:bg-blue-50">Heute</button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
