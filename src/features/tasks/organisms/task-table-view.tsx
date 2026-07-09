import { AlertTriangle, Link2 } from "lucide-react";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { TaskStatusControl } from "@/features/tasks/atoms/task-status-control";
import { GitHubSyncStatusBadge, RelationBadge } from "@/features/tasks/molecules/task-card";
import { PlanningTaskAttentionBadges } from "@/features/tasks/molecules/task-attention-badges";
import { dateRange, taskAssigneeOptions } from "@/lib/display";
import { hasGitHubIssue, hasOpenWaitingRelation, taskRelationsFor } from "@/lib/platform";
import { normalizeStatus, priorityBadgeTone } from "@/lib/status";
import type { Profile, Sprint, Task, TaskBlocker, TaskRelation, TaskStatus } from "@/lib/types";
import { UiBadge } from "@/shared/atoms/ui-primitives";
import { DataCell, DataEmptyRow, DataHeaderCell, DataOverflow, DataRow, DataSurface, DataTable, DataTableHead } from "@/shared/molecules/data-surface";

type TaskTableViewProps = {
  visibleTasks: Task[];
  profiles: Profile[];
  sprints: Sprint[];
  relations: TaskRelation[];
  allTasks: Task[];
  blockers: TaskBlocker[];
  canChangeTaskStatus: (task: Task) => boolean;
  statusOptionsForTask: (task: Task) => TaskStatus[];
  onOpenTask: (task: Task) => void;
  onUpdateTask: (task: Task, patch: Partial<Task>) => void;
};

export function TaskTableView({
  visibleTasks,
  profiles,
  sprints,
  relations,
  allTasks,
  blockers,
  canChangeTaskStatus,
  statusOptionsForTask,
  onOpenTask,
  onUpdateTask,
}: TaskTableViewProps) {
  return (
    <DataSurface>
      <DataOverflow>
        <DataTable minWidth={1040}>
        <DataTableHead>
          <tr>
            {["Aufgabe", "Status", "Zuständig", "Priorität", "Sprint", "Zeitraum", "Zieltermin", "Hinweise"].map((head) => (
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
                <DataCell className="max-w-sm">
                  <button type="button" onClick={() => onOpenTask(task)} className="inline-flex items-start gap-1.5 text-left font-semibold text-slate-900 hover:text-blue-700">
                    {!hasGitHubIssue(task) && <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />}
                    <span>{task.title}</span>
                  </button>
                  <div className="mt-1 truncate text-xs text-slate-500">{task.workstream || "ohne Bereich"}</div>
                </DataCell>
                <DataCell>
                  <TaskStatusControl
                    status={task.status}
                    canChange={canUpdateStatus}
                    onChange={(status) => onUpdateTask(task, { status })}
                    options={canUpdateStatus ? statusOptionsForTask(task) : [normalizeStatus(task.status)]}
                    selectClassName="h-8 w-32 text-xs"
                    compact
                  />
                </DataCell>
                <DataCell>
                  <CustomSelect value={task.assigneeId || task.assignee} onChange={(value) => onUpdateTask(task, { assignee: value, assigneeId: value })} className="h-8 w-36 text-xs" options={taskAssigneeOptions(task.taskType, profiles)} />
                </DataCell>
                <DataCell><UiBadge tone={priorityBadgeTone(task.priority)}>{task.priority}</UiBadge></DataCell>
                <DataCell>
                  <CustomSelect value={task.sprintId} onChange={(value) => onUpdateTask(task, { sprintId: value })} className="h-8 w-36 text-xs" options={[{ value: "", label: "Ohne Sprint" }, ...sprints.map((sprint) => ({ value: sprint.id, label: sprint.name }))]} />
                </DataCell>
                <DataCell>{dateRange(task)}</DataCell>
                <DataCell>{task.deadline}</DataCell>
                <DataCell className="max-w-52">
                  <div className="flex flex-wrap gap-1.5">
                    {hasGitHubIssue(task) && task.githubSyncStatus === "synced" ? (
                      <UiBadge tone="blue" className="gap-1">
                        <Link2 size={13} />
                        verknüpft
                      </UiBadge>
                    ) : (
                      <GitHubSyncStatusBadge task={task} compact />
                    )}
                    <PlanningTaskAttentionBadges task={task} data={{ taskBlockers: blockers, taskRelations: relations, tasks: allTasks }} excludeIds={["sync-failed", "waiting"]} compact />
                    <RelationBadge label="Wartet auf" count={relationGroups.waitsOn.length} tone={hasOpenWait ? "amber" : "slate"} />
                    <RelationBadge label="Blockiert" count={relationGroups.blocks.length} tone="blue" />
                  </div>
                </DataCell>
              </DataRow>
            );
          })}
          {!visibleTasks.length && (
            <DataEmptyRow colSpan={8}>
              Keine Aufgaben in dieser Ansicht.
            </DataEmptyRow>
          )}
        </tbody>
        </DataTable>
      </DataOverflow>
    </DataSurface>
  );
}
