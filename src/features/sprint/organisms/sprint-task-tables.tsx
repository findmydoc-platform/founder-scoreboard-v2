import { AlertTriangle } from "lucide-react";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { GitHubMissingBadge } from "@/features/tasks/molecules/task-card";
import { dateRange, taskOwnerLabel } from "@/lib/display";
import { hasGitHubIssue, reviewLabel } from "@/lib/platform";
import { normalizeStatus, statusTone, taskStatuses } from "@/lib/status";
import type { PlanningData, Sprint, Task, TaskStatus } from "@/lib/types";

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
      <section className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-950">Sprint-Aufgaben</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1180px] w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="border-b border-slate-200 px-4 py-3 font-semibold">Aufgabe</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Assignee</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Status</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Review-Status</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">CEO-Score</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Sprint</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Zeitraum</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Nächster Schritt</th>
              </tr>
            </thead>
            <tbody>
              {sprintTasks.map((task) => (
                <tr key={task.id} className="hover:bg-slate-50">
                  <td className="max-w-[360px] border-b border-slate-100 px-4 py-3">
                    <button type="button" onClick={() => onOpen(task)} className="flex max-w-full items-start gap-1.5 truncate text-left font-semibold text-slate-950 hover:text-blue-700">
                      {!hasGitHubIssue(task) && <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />}
                      <span className="truncate">{task.title}</span>
                    </button>
                    <div className="mt-1 truncate text-xs text-slate-500">{task.workstream} · {task.priority} · {task.hours}h</div>
                    {(!hasGitHubIssue(task) || task.carriedFromSprintId || task.sprintOutcome) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {!hasGitHubIssue(task) && <GitHubMissingBadge />}
                        {task.carriedFromSprintId && <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">Carry-over</span>}
                        {task.sprintOutcome && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{task.sprintOutcome}</span>}
                      </div>
                    )}
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{taskOwnerLabel(task)}</td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <CustomSelect value={normalizeStatus(task.status)} disabled={pending} onChange={(value) => onChangeStatus(task, value as TaskStatus)} className={`h-8 w-32 text-xs font-semibold ${statusTone(normalizeStatus(task.status))}`} options={taskStatuses.map((status) => ({ value: status, label: status }))} />
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">
                    <div>{reviewLabel(task.reviewStatus)}</div>
                    <div className="mt-1 text-xs text-slate-500">{reviewOwnerName(task)}{isSelfReview(task) ? " · Self-Review" : ""}</div>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">
                    {task.scorePoints} {task.scoreFinal ? "final" : "offen"}
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <CustomSelect value={task.sprintId} disabled={pending || sprint.scoreLocked} onChange={(value) => onAssignSprint(task, value)} className="h-8 w-44 text-xs" options={data.sprints.map((item) => ({ value: item.id, label: item.name }))} />
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{dateRange(task)}</td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {task.reviewStatus === "not_requested" || normalizeStatus(task.status) === "Nacharbeit" ? (
                        <button type="button" disabled={pending || sprint.scoreLocked} onClick={() => onRequestReview(task)} className="h-8 rounded-md border border-blue-200 bg-blue-50 px-2 text-xs font-semibold text-blue-700 disabled:cursor-not-allowed disabled:opacity-50">Review anfragen</button>
                      ) : null}
                      {task.reviewStatus !== "not_requested" || normalizeStatus(task.status) === "Review" ? (
                        <button
                          type="button"
                          disabled={pending || sprint.scoreLocked || task.scoreFinal || !canReviewTask(task)}
                          onClick={() => onSelectReviewTask(task.id)}
                          className="h-8 rounded-md border border-blue-200 bg-blue-50 px-2 text-xs font-semibold text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Review-Blatt
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!sprintTasks.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                    Noch keine Aufgaben in diesem Sprint.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {otherTasks.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-base font-semibold text-slate-950">Backlog und andere Sprints</h2>
            <p className="text-xs text-slate-500">Nicht im ausgewählten Sprint.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[840px] w-full border-separate border-spacing-0 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="border-b border-slate-200 px-4 py-3 font-semibold">Aufgabe</th>
                  <th className="border-b border-slate-200 px-3 py-3 font-semibold">Assignee</th>
                  <th className="border-b border-slate-200 px-3 py-3 font-semibold">Aktueller Sprint</th>
                  <th className="border-b border-slate-200 px-3 py-3 font-semibold">Zuweisung</th>
                </tr>
              </thead>
              <tbody>
                {otherTasks.map((task) => {
                  const currentSprint = data.sprints.find((item) => item.id === task.sprintId);
                  return (
                    <tr key={task.id} className="hover:bg-slate-50">
                      <td className="max-w-[420px] border-b border-slate-100 px-4 py-3">
                        <button type="button" onClick={() => onOpen(task)} className="block truncate text-left font-semibold text-slate-950 hover:text-blue-700">
                          {task.title}
                        </button>
                        <div className="mt-1 truncate text-xs text-slate-500">{task.workstream} · {task.priority} · {task.hours}h</div>
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{taskOwnerLabel(task)}</td>
                      <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{currentSprint?.name || "ohne Sprint"}</td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        <CustomSelect value={task.sprintId} disabled={pending} onChange={(value) => onAssignSprint(task, value)} className="h-8 w-56 text-xs" options={data.sprints.map((item) => ({ value: item.id, label: item.name }))} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}
