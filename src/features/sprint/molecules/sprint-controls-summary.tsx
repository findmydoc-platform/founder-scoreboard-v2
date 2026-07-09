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
  const reviewDueLabel = sprint.reviewDueAt
    ? new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(sprint.reviewDueAt))
    : "ohne Datum";
  const summaryItems = [
    { label: "Aufgaben", value: sprintTasks.length },
    { label: "Review", value: reviewTasksCount },
    { label: "Scores final", value: `${finalScores}/${sprintTasks.length}` },
    { label: "Scores offen", value: openScores },
    { label: "Ohne Sprint", value: unassignedTasksCount },
  ];

  return (
    <UiPanel padding="none" className="min-w-0">
      <div className="flex flex-wrap items-end justify-between gap-3 p-4">
        <div className="flex min-w-0 flex-wrap items-end gap-2">
          <label className="grid min-w-56 gap-1 text-xs font-semibold text-slate-500">
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
          {sprintIsCurrent && (
            <span
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-emerald-200 bg-emerald-50 text-emerald-600"
              aria-label="Aktueller Sprint"
              title="Aktueller Sprint"
            >
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.16)]" />
            </span>
          )}
          {sprintHasTasks && (
            <UiBadge
              size="xs"
              className="h-9 gap-1.5"
              aria-label={`${sprintTasks.length} verknüpfte Aufgaben, Zeitraum geschützt`}
              title={`${sprintTasks.length} verknüpfte Aufgaben, Zeitraum geschützt`}
            >
              <Lock size={13} />
              {sprintTasks.length}
            </UiBadge>
          )}
          <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-600">
            {formatDate(sprint.startDate)} - {formatDate(sprint.endDate)}
          </div>
          <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-600">
            Review bis {reviewDueLabel}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid min-w-36 gap-1 text-xs font-semibold text-slate-500">
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
            className="h-9"
          >
            Sprint abschließen
          </UiButton>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
        {summaryItems.map((item) => (
          <span key={item.label} className="inline-flex h-8 items-center gap-2 rounded-md bg-slate-50 px-3 text-xs font-semibold text-slate-600">
            <span className="text-slate-950">{item.value}</span>
            {item.label}
          </span>
        ))}
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
