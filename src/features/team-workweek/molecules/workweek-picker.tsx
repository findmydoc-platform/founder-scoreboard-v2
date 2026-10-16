"use client";

import { useState, type RefObject } from "react";
import { addCalendarDays, berlinDateKey } from "../model/team-workweek-calendar";
import { weekStartFromInput, workweekInputValue, workweekLabel, workweekStart } from "../model/team-workweek-week";

export function WorkweekPicker({ value, disabled, onChange, focusRef }: {
  value: string; disabled: boolean; onChange: (week: string) => void; focusRef?: RefObject<HTMLSelectElement | null>;
}) {
  const current = workweekStart();
  const next = addCalendarDays(current, 7);
  const [chooseFurther, setChooseFurther] = useState(false);
  const further = chooseFurther || (value !== current && value !== next);
  const control = "min-h-11 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100";
  return <div className="grid gap-2">
    <label className="grid gap-2 text-sm font-semibold text-slate-950">
      Ab welcher Woche gelten diese Arbeitszeiten?
      <select ref={focusRef} data-tour-id="workweek-week-picker" aria-label="Arbeitswoche auswählen" title={workweekLabel(value)} className={control} disabled={disabled} value={further ? "other" : value} onChange={(event) => {
        const selected = event.target.value;
        setChooseFurther(selected === "other");
        if (selected !== "other") onChange(selected);
      }}>
        <option value={current}>{workweekLabel(current, berlinDateKey(), true)}</option>
        <option value={next}>{workweekLabel(next, berlinDateKey(), true)}</option>
        <option value="other">Weitere Woche auswählen</option>
      </select>
    </label>
    {further && <label className="grid gap-1 text-xs text-slate-600">Weitere Woche
      <input type="week" aria-label="Weitere Arbeitswoche auswählen" className={control} disabled={disabled} min={workweekInputValue(current)} value={workweekInputValue(value)} onChange={(event) => {
        const week = weekStartFromInput(event.target.value);
        if (week && week >= current) onChange(week);
      }} />
      <span>{workweekLabel(value)}</span>
    </label>}
  </div>;
}
