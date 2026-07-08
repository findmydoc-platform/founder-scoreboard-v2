import { AlertTriangle } from "lucide-react";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { GitHubMissingBadge } from "@/features/tasks/molecules/task-card";
import { dateRange, taskAssigneeLabel } from "@/lib/display";
import { hasGitHubIssue, reviewLabel } from "@/lib/platform";
import { normalizeStatus, taskStatuses } from "@/lib/status";
import type { PlanningData, Sprint, Task, TaskStatus } from "@/lib/types";
import { UiBadge, UiButton } from "@/shared/atoms/ui-primitives";
import { DataCell, DataEmptyRow, DataHeaderCell, DataOverflow, DataRow, DataSurface, DataTable, DataTableHead } from "@/shared/molecules/data-surface";

export function SprintTaskTables({
  data,
  sprint,
  sprintTasks,
  otherTasks,
  pending,
  canReviewTask,
  reviewOwnerName,
  isSelfReview,
  onOpen,
  onRequestReview,
  onChangeStatus,
  onAssignSprint,
  onSelectReviewTask,
}: {
  data: PlanningData;
  sprint: Sprint;
  sprintTasks: Task[];
  otherTasks: Task[];
  pending: boolean;
  canReviewTask: (task: Task) => boolean;
  reviewOwnerName: (task: Task) => string;
  isSelfReview: (task: Task) => boolean;
  onOpen: (task: Task) => void;
  onRequestReview: (task: Task) => void;
  onChangeStatus: (task: Task, status: TaskStatus) => void;
  onAssignSprint: (task: Task, sprintId: string) => void;
  onSelectReviewTask: (taskId: string) => void;
}) {
  return (
    <>
      <DataSurface title="Sprint-Aufgaben">
        <DataOverflow>
          <DataTable minWidth={1180}>
            <DataTableHead>
              <tr>
                <DataHeaderCell className="px-4">Aufgabe</DataHeaderCell>
                <DataHeaderCell>Zuständig</DataHeaderCell>
                <DataHeaderCell>Status</DataHeaderCell>
                <DataHeaderCell>Review-Status</DataHeaderCell>
                <DataHeaderCell>CEO-Score</DataHeaderCell>
                <DataHeaderCell>Sprint</DataHeaderCell>
                <DataHeaderCell>Zeitraum</DataHeaderCell>
                <DataHeaderCell>Nächster Schritt</DataHeaderCell>
              </tr>
            </DataTableHead>
            <tbody>
              {sprintTasks.map((task) => (
                <DataRow key={task.id}>
                  <DataCell className="max-w-[360px] px-4">
                    <button type="button" onClick={() => onOpen(task)} className="flex max-w-full items-start gap-1.5 truncate text-left font-semibold text-slate-950 hover:text-blue-700">
                      {!hasGitHubIssue(task) && <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />}
                      <span className="truncate">{task.title}</span>
                    </button>
                    <div className="mt-1 truncate text-xs text-slate-500">{task.workstream} · {task.priority} · {task.hours}h</div>
                    {(!hasGitHubIssue(task) || task.carriedFromSprintId || task.sprintOutcome) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {!hasGitHubIssue(task) && <GitHubMissingBadge />}
                        {task.carriedFromSprintId && <UiBadge tone="blue" size="xs" className="text-[11px]">Carry-over</UiBadge>}
                        {task.sprintOutcome && <UiBadge tone="slate" size="xs" className="text-[11px]">{task.sprintOutcome}</UiBadge>}
                      </div>
                    )}
                  </DataCell>
                  <DataCell className="text-slate-700">{taskAssigneeLabel(task)}</DataCell>
                  <DataCell>
                    <CustomSelect value={normalizeStatus(task.status)} disabled={pending} onChange={(value) => onChangeStatus(task, value as TaskStatus)} className="h-8 w-32 text-xs font-semibold" options={taskStatuses.map((status) => ({ value: status, label: status }))} />
                  </DataCell>
                  <DataCell className="text-slate-700">
                    <div>{reviewLabel(task.reviewStatus)}</div>
                    <div className="mt-1 text-xs text-slate-500">{reviewOwnerName(task)}{isSelfReview(task) ? " · Self-Review" : ""}</div>
                  </DataCell>
                  <DataCell className="text-slate-700">
                    {task.scorePoints} {task.scoreFinal ? "final" : "offen"}
                  </DataCell>
                  <DataCell>
                    <CustomSelect value={task.sprintId} disabled={pending || sprint.scoreLocked} onChange={(value) => onAssignSprint(task, value)} className="h-8 w-44 text-xs" options={data.sprints.map((item) => ({ value: item.id, label: item.name }))} />
                  </DataCell>
                  <DataCell className="text-slate-700">{dateRange(task)}</DataCell>
                  <DataCell>
                    <div className="flex flex-wrap gap-1.5">
                      {task.reviewStatus === "not_requested" || normalizeStatus(task.status) === "Nacharbeit" ? (
                        <UiButton type="button" disabled={pending || sprint.scoreLocked} onClick={() => onRequestReview(task)} variant="blue" size="xs">Review anfragen</UiButton>
                      ) : null}
                      {task.reviewStatus !== "not_requested" || normalizeStatus(task.status) === "Review" ? (
                        <UiButton
                          type="button"
                          disabled={pending || sprint.scoreLocked || task.scoreFinal || !canReviewTask(task)}
                          onClick={() => onSelectReviewTask(task.id)}
                          variant="blue"
                          size="xs"
                        >
                          Review-Blatt
                        </UiButton>
                      ) : null}
                    </div>
                  </DataCell>
                </DataRow>
              ))}
              {!sprintTasks.length && (
                <DataEmptyRow colSpan={8}>
                  Noch keine Aufgaben in diesem Sprint.
                </DataEmptyRow>
              )}
            </tbody>
          </DataTable>
        </DataOverflow>
      </DataSurface>

      {otherTasks.length > 0 && (
        <DataSurface title="Backlog und andere Sprints" description="Nicht im ausgewählten Sprint.">
          <DataOverflow>
            <DataTable minWidth={840}>
              <DataTableHead>
                <tr>
                  <DataHeaderCell className="px-4">Aufgabe</DataHeaderCell>
                  <DataHeaderCell>Zuständig</DataHeaderCell>
                  <DataHeaderCell>Aktueller Sprint</DataHeaderCell>
                  <DataHeaderCell>Zuweisung</DataHeaderCell>
                </tr>
              </DataTableHead>
              <tbody>
                {otherTasks.map((task) => {
                  const currentSprint = data.sprints.find((item) => item.id === task.sprintId);
                  return (
                    <DataRow key={task.id}>
                      <DataCell className="max-w-[420px] px-4">
                        <button type="button" onClick={() => onOpen(task)} className="block truncate text-left font-semibold text-slate-950 hover:text-blue-700">
                          {task.title}
                        </button>
                        <div className="mt-1 truncate text-xs text-slate-500">{task.workstream} · {task.priority} · {task.hours}h</div>
                      </DataCell>
                      <DataCell className="text-slate-700">{taskAssigneeLabel(task)}</DataCell>
                      <DataCell className="text-slate-700">{currentSprint?.name || "ohne Sprint"}</DataCell>
                      <DataCell>
                        <CustomSelect value={task.sprintId} disabled={pending} onChange={(value) => onAssignSprint(task, value)} className="h-8 w-56 text-xs" options={data.sprints.map((item) => ({ value: item.id, label: item.name }))} />
                      </DataCell>
                    </DataRow>
                  );
                })}
              </tbody>
            </DataTable>
          </DataOverflow>
        </DataSurface>
      )}
    </>
  );
}
