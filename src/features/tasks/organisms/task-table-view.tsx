import { AlertTriangle, Link2 } from "lucide-react";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { GitHubSyncStatusBadge, RelationBadge } from "@/features/tasks/molecules/task-card";
import { dateRange, taskAssigneeOptions } from "@/lib/display";
import { hasGitHubIssue, hasOpenWaitingRelation, taskRelationsFor } from "@/lib/platform";
import { normalizeStatus, priorityBadgeTone } from "@/lib/status";
import type { Profile, Task, TaskRelation, TaskStatus } from "@/lib/types";
import { UiBadge } from "@/shared/atoms/ui-primitives";
import { DataCell, DataEmptyRow, DataHeaderCell, DataOverflow, DataRow, DataSurface, DataTable, DataTableHead } from "@/shared/molecules/data-surface";

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
    <DataSurface>
      <DataOverflow>
        <DataTable minWidth={1320}>
        <DataTableHead>
          <tr>
            {["Status", "Ablage", "Zuständig", "Priorität", "Bereich", "Aufgabe", "Aufwand", "Zeitraum", "Zieltermin", "Abhängigkeit", "Qualitätsstandard"].map((head) => (
              <DataHeaderCell key={head}>{head}</DataHeaderCell>
            ))}
          </tr>
        </DataTableHead>
        <tbody>
          {visibleTasks.map((task) => {
            const relationGroups = taskRelationsFor(task.id, relations);
            const hasOpenWait = hasOpenWaitingRelation(task.id, allTasks, relations);
            const canUpdateStatus = canChangeTaskStatus(task);
            return (
              <DataRow key={task.id}>
                <DataCell>
                  <CustomSelect value={normalizeStatus(task.status)} disabled={!canUpdateStatus} onChange={(value) => onUpdateTask(task, { status: value })} className="h-8 w-32 text-xs" options={(canUpdateStatus ? statusOptionsForTask(task) : [normalizeStatus(task.status)]).map((status) => ({ value: status, label: status }))} />
                </DataCell>
                <DataCell>
                  {hasGitHubIssue(task) && task.githubSyncStatus === "synced" ? (
                    <UiBadge tone="blue" className="gap-1">
                      <Link2 size={13} />
                      verknüpft
                    </UiBadge>
                  ) : (
                    <GitHubSyncStatusBadge task={task} />
                  )}
                </DataCell>
                <DataCell>
                  <CustomSelect value={task.assigneeId || task.assignee} onChange={(value) => onUpdateTask(task, { assignee: value, assigneeId: value })} className="h-8 w-36 text-xs" options={taskAssigneeOptions(task.taskType, profiles)} />
                </DataCell>
                <DataCell><UiBadge tone={priorityBadgeTone(task.priority)}>{task.priority}</UiBadge></DataCell>
                <DataCell className="text-slate-600">{task.workstream}</DataCell>
                <DataCell className="max-w-sm">
                  <button type="button" onClick={() => onOpenTask(task)} className="inline-flex items-start gap-1.5 text-left font-semibold text-slate-900 hover:text-blue-700">
                    {!hasGitHubIssue(task) && <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />}
                    <span>{task.title}</span>
                  </button>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-500">{task.description}</p>
                </DataCell>
                <DataCell>{task.hours}h</DataCell>
                <DataCell>{dateRange(task)}</DataCell>
                <DataCell>{task.deadline}</DataCell>
                <DataCell className="max-w-52">
                  <div className="flex flex-wrap gap-1.5">
                    <RelationBadge label="Wartet auf" count={relationGroups.waitsOn.length} tone={hasOpenWait ? "amber" : "slate"} />
                    <RelationBadge label="Blockiert" count={relationGroups.blocks.length} tone="blue" />
                    {!relationGroups.waitsOn.length && !relationGroups.blocks.length && <span className="text-xs text-slate-400">-</span>}
                  </div>
                </DataCell>
                <DataCell className="max-w-sm text-xs leading-5 text-slate-600">{task.definitionOfDone}</DataCell>
              </DataRow>
            );
          })}
          {!visibleTasks.length && (
            <DataEmptyRow colSpan={11}>
              Keine Aufgaben in dieser Ansicht.
            </DataEmptyRow>
          )}
        </tbody>
        </DataTable>
      </DataOverflow>
    </DataSurface>
  );
}
