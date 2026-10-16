"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { addCalendarDays } from "../model/team-workweek-calendar";
import { workweekLabel, workweekStart } from "../model/team-workweek-week";
import { UiButton } from "@/shared/atoms/ui-primitives";

export function WorkweekNavigation({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  return <div data-tour-id="workweek-navigation" className="flex flex-wrap items-center justify-between gap-2 py-3" role="group" aria-label="Angezeigte Arbeitswoche">
    <p className="text-sm font-semibold text-slate-900" aria-live="polite">{workweekLabel(value)}</p>
    <div className="flex items-center gap-1">
      <UiButton size="iconLg" aria-label="Vorherige Woche" onClick={() => onChange(addCalendarDays(value, -7))}><ChevronLeft size={16} /></UiButton>
      <UiButton className="min-h-11" size="sm" onClick={() => onChange(workweekStart())}>Diese Woche</UiButton>
      <UiButton size="iconLg" aria-label="Nächste Woche" onClick={() => onChange(addCalendarDays(value, 7))}><ChevronRight size={16} /></UiButton>
    </div>
  </div>;
}
