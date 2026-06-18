import { AlertTriangle, Link2 } from "lucide-react";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { GitHubMissingBadge, RelationBadge } from "@/features/tasks/molecules/task-card";
import { dateRange, taskOwnerOptions } from "@/lib/display";
import { hasGitHubIssue, hasOpenWaitingRelation, taskRelationsFor } from "@/lib/platform";
import { normalizeStatus, priorityTone } from "@/lib/status";
import type { Profile, Task, TaskRelation, TaskStatus } from "@/lib/types";

type TaskTableViewProps = {
  visibleTasks: Task[];
  profiles: Profile[];
  relations: TaskRelation[];
  allTasks: Task[];
  canChangeTaskStatus: (task: Task) => boolean;
  statusOptionsForTask: (task: Task) => TaskStatus[];
  onOpenTask: (task: Task) => void;
  onUpdateTask: (task: Task, patch: Partial<Task>) => void;
};

export function TaskTableView({
  visibleTasks,
  profiles,
  relations,
  allTasks,
  canChangeTaskStatus,
  statusOptionsForTask,
  onOpenTask,
  onUpdateTask,
}: TaskTableViewProps) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="min-w-[1320px] w-full border-collapse text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
          <tr>
            {["Status", "GitHub", "Assignee", "Priorität", "Workstream", "Aufgabe", "Aufwand", "Zeitraum", "Zieltermin", "Abhängigkeit", "Definition of Done"].map((head) => (
              <th key={head} className="border-b border-slate-200 px-3 py-3">{head}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleTasks.map((task) => {
            const relationGroups = taskRelationsFor(task.id, relations);
            const hasOpenWait = hasOpenWaitingRelation(task.id, allTasks, relations);
            const canUpdateStatus = canChangeTaskStatus(task);
            return (
              <tr key={task.id} className="border-b border-slate-100 align-top hover:bg-slate-50">
                <td className="px-3 py-3">
                  <CustomSelect value={normalizeStatus(task.status)} disabled={!canUpdateStatus} onChange={(value) => onUpdateTask(task, { status: value })} className="h-8 w-32 text-xs" options={(canUpdateStatus ? statusOptionsForTask(task) : [normalizeStatus(task.status)]).map((status) => ({ value: status, label: status }))} />
                </td>
                <td className="px-3 py-3">
                  {hasGitHubIssue(task) ? (
                    <span className="inline-flex items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                      <Link2 size={13} />
                      verknüpft
                    </span>
                  ) : (
                    <GitHubMissingBadge />
                  )}
                </td>
                <td className="px-3 py-3">
                  <CustomSelect value={task.owner} onChange={(value) => onUpdateTask(task, { owner: value })} className="h-8 w-36 text-xs" options={taskOwnerOptions(task.taskType, profiles)} />
                </td>
                <td className="px-3 py-3"><span className={`rounded-full border px-2 py-1 text-xs font-semibold ${priorityTone(task.priority)}`}>{task.priority}</span></td>
                <td className="px-3 py-3 text-slate-600">{task.workstream}</td>
                <td className="max-w-sm px-3 py-3">
                  <button type="button" onClick={() => onOpenTask(task)} className="inline-flex items-start gap-1.5 text-left font-semibold text-slate-900 hover:text-blue-700">
                    {!hasGitHubIssue(task) && <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />}
                    <span>{task.title}</span>
                  </button>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-500">{task.description}</p>
                </td>
                <td className="px-3 py-3">{task.hours}h</td>
                <td className="px-3 py-3">{dateRange(task)}</td>
                <td className="px-3 py-3">{task.deadline}</td>
                <td className="max-w-52 px-3 py-3">
                  <div className="flex flex-wrap gap-1.5">
                    <RelationBadge label="Wartet auf" count={relationGroups.waitsOn.length} tone={hasOpenWait ? "amber" : "slate"} />
                    <RelationBadge label="Blockiert" count={relationGroups.blocks.length} tone="blue" />
                    {!relationGroups.waitsOn.length && !relationGroups.blocks.length && <span className="text-xs text-slate-400">-</span>}
                  </div>
                </td>
                <td className="max-w-sm px-3 py-3 text-xs leading-5 text-slate-600">{task.definitionOfDone}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
