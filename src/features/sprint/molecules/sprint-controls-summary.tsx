import { Lock } from "lucide-react";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { UiBadge, UiButton, UiNotice, UiPanel } from "@/shared/atoms/ui-primitives";
import { formatDate } from "@/lib/display";
import type { PlanningData, Sprint, Task } from "@/lib/types";

export function SprintControlsSummary({
  data,
  sprint,
  currentSprint,
  sprintTasks,
  reviewTasksCount,
  finalScores,
  openScores,
  unassignedTasksCount,
  sprintHasTasks,
  sprintIsCurrent,
  sprintControlsDisabled,
  sprintLockMessage,
  openObjectionsCount,
  onSelectedSprintChange,
  onUpdateSprint,
  onLockSprint,
}: {
  data: PlanningData;
  sprint: Sprint;
  currentSprint?: Sprint;
  sprintTasks: Task[];
  reviewTasksCount: number;
  finalScores: number;
  openScores: number;
  unassignedTasksCount: number;
  sprintHasTasks: boolean;
  sprintIsCurrent: boolean;
  sprintControlsDisabled: boolean;
  sprintLockMessage: string;
  openObjectionsCount: number;
  onSelectedSprintChange: (sprintId: string) => void;
  onUpdateSprint: (sprint: Sprint, patch: Partial<Sprint>) => void;
  onLockSprint: (sprintId: string) => void;
}) {
  return (
    <UiPanel padding="none" className="min-w-0">
      <div className="grid gap-3 border-b border-slate-100 p-4 xl:grid-cols-[minmax(220px,1.3fr)_repeat(4,minmax(150px,1fr))_auto] xl:items-end">
        <label className="grid gap-1 text-xs font-semibold text-slate-500">
          Sprint
          <CustomSelect
            value={sprint.id}
            onChange={onSelectedSprintChange}
            className="h-9 text-sm"
            options={data.sprints.map((item) => ({
              value: item.id,
              label: item.name,
              current: currentSprint?.id === item.id,
              locked: data.tasks.some((task) => task.sprintId === item.id),
            }))}
          />
        </label>
        <div className="grid gap-1 text-xs font-semibold text-slate-500">
          Start
          <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-900">{formatDate(sprint.startDate)}</div>
        </div>
        <div className="grid gap-1 text-xs font-semibold text-slate-500">
          Ende
          <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-900">{formatDate(sprint.endDate)}</div>
        </div>
        <div className="grid gap-1 text-xs font-semibold text-slate-500">
          Review bis
          <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-900">
            {sprint.reviewDueAt ? new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(sprint.reviewDueAt)) : "ohne Datum"}
          </div>
        </div>
        <label className="grid gap-1 text-xs font-semibold text-slate-500">
          Status
          <CustomSelect
            value={sprint.status}
            disabled={sprintControlsDisabled || sprint.scoreLocked}
            onChange={(value) => onUpdateSprint(sprint, { status: value as Sprint["status"] })}
            className="h-9 text-sm"
            options={[
              { value: "planning", label: "Planung" },
              { value: "active", label: "Aktiv" },
              { value: "review", label: "Review" },
              { value: "closed", label: "Abgeschlossen" },
            ]}
          />
        </label>
        <UiButton
          type="button"
          disabled={sprintControlsDisabled || sprint.scoreLocked}
          onClick={() => onLockSprint(sprint.id)}
        >
          Sprint abschließen
        </UiButton>
      </div>
      <div className="grid gap-3 px-4 py-3 text-sm text-slate-600 sm:grid-cols-2 xl:grid-cols-5">
        <div><span className="font-semibold text-slate-950">{sprintTasks.length}</span> Aufgaben im Sprint</div>
        <div><span className="font-semibold text-slate-950">{reviewTasksCount}</span> im Review</div>
        <div><span className="font-semibold text-slate-950">{finalScores}/{sprintTasks.length}</span> Scores final</div>
        <div><span className="font-semibold text-slate-950">{openScores}</span> Scores offen</div>
        <div><span className="font-semibold text-slate-950">{unassignedTasksCount}</span> ohne Sprint</div>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
        {sprintIsCurrent && (
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-600"
            aria-label="Aktueller Sprint"
            title="Aktueller Sprint"
          >
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.16)]" />
          </span>
        )}
        {sprintHasTasks && (
          <UiBadge
            size="xs"
            className="h-7 gap-1.5"
            aria-label={`${sprintTasks.length} verknüpfte Aufgaben, Zeitraum geschützt`}
            title={`${sprintTasks.length} verknüpfte Aufgaben, Zeitraum geschützt`}
          >
            <Lock size={13} />
            {sprintTasks.length}
          </UiBadge>
        )}
      </div>
      {sprintLockMessage && (
        <UiNotice tone="info" radius="none" className="!border-x-0 !border-b-0 border-t-blue-100 px-4 py-3 font-medium">
          {sprintLockMessage}
        </UiNotice>
      )}
      {openObjectionsCount > 0 && (
        <UiNotice tone="warning" radius="none" className="!border-x-0 !border-b-0 border-t-amber-100 px-4 py-3 font-medium">
          {openObjectionsCount} offener Score-Einwand blockiert den Sprint-Lock bis zur Prüfung.
        </UiNotice>
      )}
    </UiPanel>
  );
}
