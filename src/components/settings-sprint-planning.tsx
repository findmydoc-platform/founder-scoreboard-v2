"use client";

import { CustomDatePicker } from "@/components/custom-date-picker";

export type SprintPlanningOptions = {
  firstSprintNumber: number;
  anchorStartDate: string;
  rhythmWeeks: number;
  horizonWeeks: number;
  targetSprintNumber: number;
};

export function SprintPlanningSection({
  pending,
  sprintPlanningOptions,
  plannedSprintCount,
  onUpdateSprintPlanning,
  onCreateSprintPlan,
}: {
  pending: boolean;
  sprintPlanningOptions: SprintPlanningOptions;
  plannedSprintCount: number;
  onUpdateSprintPlanning: (options: SprintPlanningOptions) => void;
  onCreateSprintPlan: (options: SprintPlanningOptions) => void;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-slate-950">Sprint-Planung</h2>
          <p className="mt-1 text-sm text-slate-500">Legt Sprint-Zeiträume aus Startdatum und Rhythmus fest. Beispiel: 01.06.2026 plus 2 Wochen ergibt 01.06.-14.06., danach 15.06.-28.06.</p>
        </div>
        <button
          type="button"
          disabled={pending || plannedSprintCount === 0}
          onClick={() => onCreateSprintPlan(sprintPlanningOptions)}
          className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {plannedSprintCount > 0 ? `${plannedSprintCount} Änderung${plannedSprintCount === 1 ? "" : "en"} anwenden` : "Plan aktuell"}
        </button>
      </div>
      <div className="mt-4 grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <div className="grid min-w-0 gap-1 text-xs font-semibold text-slate-500">
          Namenslogik
          <div className="flex h-9 w-full min-w-0 items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-900">
            Sprint + Nummer
          </div>
        </div>
        <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate-500">
          Erste Sprint-Nr.
          <input
            type="number"
            min={1}
            value={sprintPlanningOptions.firstSprintNumber}
            onChange={(event) => onUpdateSprintPlanning({ ...sprintPlanningOptions, firstSprintNumber: Number(event.target.value) })}
            className="h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-900"
          />
        </label>
        <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate-500">
          Startdatum
          <CustomDatePicker
            value={sprintPlanningOptions.anchorStartDate}
            onChange={(value) => onUpdateSprintPlanning({ ...sprintPlanningOptions, anchorStartDate: value })}
            className="h-9 w-full text-sm"
          />
        </label>
        <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate-500">
          Rhythmus (Wochen)
          <input
            type="number"
            min={1}
            max={12}
            value={sprintPlanningOptions.rhythmWeeks}
            onChange={(event) => onUpdateSprintPlanning({ ...sprintPlanningOptions, rhythmWeeks: Number(event.target.value) })}
            className="h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-900"
          />
        </label>
        <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate-500">
          Wochen voraus
          <input
            type="number"
            min={1}
            max={52}
            value={sprintPlanningOptions.horizonWeeks}
            onChange={(event) => onUpdateSprintPlanning({ ...sprintPlanningOptions, horizonWeeks: Number(event.target.value) })}
            className="h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-900"
          />
        </label>
        <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate-500">
          Bis Sprint-Nr.
          <input
            type="number"
            min={0}
            value={sprintPlanningOptions.targetSprintNumber || ""}
            onChange={(event) => onUpdateSprintPlanning({ ...sprintPlanningOptions, targetSprintNumber: Number(event.target.value) })}
            className="h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-900"
            placeholder="optional"
          />
        </label>
      </div>
    </section>
  );
}
