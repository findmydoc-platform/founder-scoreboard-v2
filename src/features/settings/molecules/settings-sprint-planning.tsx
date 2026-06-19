"use client";

import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { UiButton, UiField, UiPanel, UiTextInput } from "@/shared/atoms/ui-primitives";

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
    <UiPanel className="xl:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold text-slate-950">Sprint-Planung</h2>
          <p className="mt-1 text-sm text-slate-500">Legt Sprint-Zeiträume aus Startdatum und Rhythmus fest. Beispiel: 01.06.2026 plus 2 Wochen ergibt 01.06.-14.06., danach 15.06.-28.06.</p>
        </div>
        <UiButton
          disabled={pending || plannedSprintCount === 0}
          onClick={() => onCreateSprintPlan(sprintPlanningOptions)}
        >
          {plannedSprintCount > 0 ? `${plannedSprintCount} Änderung${plannedSprintCount === 1 ? "" : "en"} anwenden` : "Plan aktuell"}
        </UiButton>
      </div>
      <div className="mt-4 grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        <UiField as="div" className="min-w-0">
          Namenslogik
          <div className="flex h-9 w-full min-w-0 items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-900">
            Sprint + Nummer
          </div>
        </UiField>
        <UiField className="min-w-0">
          Erste Sprint-Nr.
          <UiTextInput
            type="number"
            min={1}
            value={sprintPlanningOptions.firstSprintNumber}
            onChange={(event) => onUpdateSprintPlanning({ ...sprintPlanningOptions, firstSprintNumber: Number(event.target.value) })}
            className="w-full min-w-0"
          />
        </UiField>
        <UiField className="min-w-0">
          Startdatum
          <CustomDatePicker
            value={sprintPlanningOptions.anchorStartDate}
            onChange={(value) => onUpdateSprintPlanning({ ...sprintPlanningOptions, anchorStartDate: value })}
            className="h-9 w-full text-sm"
          />
        </UiField>
        <UiField className="min-w-0">
          Rhythmus (Wochen)
          <UiTextInput
            type="number"
            min={1}
            max={12}
            value={sprintPlanningOptions.rhythmWeeks}
            onChange={(event) => onUpdateSprintPlanning({ ...sprintPlanningOptions, rhythmWeeks: Number(event.target.value) })}
            className="w-full min-w-0"
          />
        </UiField>
        <UiField className="min-w-0">
          Wochen voraus
          <UiTextInput
            type="number"
            min={1}
            max={52}
            value={sprintPlanningOptions.horizonWeeks}
            onChange={(event) => onUpdateSprintPlanning({ ...sprintPlanningOptions, horizonWeeks: Number(event.target.value) })}
            className="w-full min-w-0"
          />
        </UiField>
        <UiField className="min-w-0">
          Bis Sprint-Nr.
          <UiTextInput
            type="number"
            min={0}
            value={sprintPlanningOptions.targetSprintNumber || ""}
            onChange={(event) => onUpdateSprintPlanning({ ...sprintPlanningOptions, targetSprintNumber: Number(event.target.value) })}
            className="w-full min-w-0"
            placeholder="optional"
          />
        </UiField>
      </div>
    </UiPanel>
  );
}
