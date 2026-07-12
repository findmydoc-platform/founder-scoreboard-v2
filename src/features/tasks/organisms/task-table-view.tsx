"use client";

import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { CustomSelect } from "@/shared/atoms/custom-select";
import type { PlanningFilters } from "@/features/planning/hooks/use-planning-view-state";
import { TaskReferenceLink } from "@/features/tasks/atoms/task-reference-link";
import { TaskStatusControl } from "@/features/tasks/atoms/task-status-control";
import { taskPlanningAttentionSignals, type TaskAttentionSignal } from "@/features/tasks/model/task-attention-signals";
import { dateRange, taskAssigneeOptions } from "@/lib/display";
import { hasGitHubIssue, hasOpenWaitingRelation, taskRelationsFor } from "@/lib/platform";
import { normalizeStatus, priorityBadgeTone } from "@/lib/status";
import type { Profile, Sprint, Task, TaskBlocker, TaskRelation, TaskStatus } from "@/lib/types";
import { UiBadge, type UiTone } from "@/shared/atoms/ui-primitives";
import { ColumnFilterPopover } from "@/shared/molecules/column-filter-popover";
import { DataCell, DataColumnHeader, DataEmptyRow, DataRow, DataTableFrame, DataTableHead, type SortDirection } from "@/shared/molecules/data-surface";
import { buildTaskTableViewModel, type TaskTableSort } from "@/features/tasks/model/task-table-view-model";

type TaskTableViewProps = {
  visibleTasks: Task[];
  profiles: Profile[];
  sprints: Sprint[];
  relations: TaskRelation[];
  allTasks: Task[];
  blockers: TaskBlocker[];
  filters: PlanningFilters;
  canChangeTaskStatus: (task: Task) => boolean;
  statusOptionsForTask: (task: Task) => TaskStatus[];
  onOpenTask: (taskId: string) => void;
  onUpdateTask: (task: Task, patch: Partial<Task>) => void;
  onFiltersChange: (filters: PlanningFilters) => void;
};

type TableRiskSignal = {
  id: string;
  label: string;
  tone: Extract<UiTone, "amber" | "blue" | "red" | "slate" | "white">;
};

function attentionTone(signal: TaskAttentionSignal): TableRiskSignal["tone"] {
  if (signal.kind === "critical") return "red";
  if (signal.kind === "review") return "blue";
  return "amber";
}

function githubRiskSignal(task: Task): TableRiskSignal | null {
  if (!hasGitHubIssue(task)) return { id: "github-missing", label: "Kein GitHub Issue", tone: "amber" };
  if (task.githubIssueSyncStatus === "pending") return { id: "github-pending", label: "Sync läuft", tone: "amber" };
  if (task.githubIssueSyncStatus === "failed") return { id: "github-failed", label: "Sync fehlgeschlagen", tone: "red" };
  if (task.githubIssueSyncStatus !== "synced") return { id: "github-open", label: "GitHub offen", tone: "blue" };
  return null;
}

function TaskTableRiskBadges({
  task,
  relations,
  allTasks,
  blockers,
  maxVisible = 3,
}: {
  task: Task;
  relations: TaskRelation[];
  allTasks: Task[];
  blockers: TaskBlocker[];
  maxVisible?: number;
}) {
  const relationGroups = taskRelationsFor(task.id, relations);
  const hasOpenWait = hasOpenWaitingRelation(task.id, allTasks, relations);
  const signals = [
    githubRiskSignal(task),
    ...taskPlanningAttentionSignals(task, { taskBlockers: blockers, taskRelations: relations, tasks: allTasks })
      .filter((signal) => signal.id !== "sync-failed")
      .map((signal) => ({ id: signal.id, label: signal.label, tone: attentionTone(signal) })),
    relationGroups.waitsOn.length ? { id: "waits-on", label: `Wartet auf ${relationGroups.waitsOn.length}`, tone: hasOpenWait ? "amber" : "slate" } : null,
    relationGroups.blocks.length ? { id: "blocks", label: `Blockiert ${relationGroups.blocks.length}`, tone: "blue" } : null,
  ].filter((signal): signal is TableRiskSignal => Boolean(signal));

  if (!signals.length) return <span className="text-xs text-slate-400">-</span>;

  const visibleSignals = signals.slice(0, maxVisible);
  const hiddenCount = signals.length - visibleSignals.length;

  return (
    <div className="flex flex-wrap gap-1.5">
      {visibleSignals.map((signal) => (
        <UiBadge key={signal.id} tone={signal.tone} size="xs" className="px-1.5 text-[10px]">
          {signal.label}
        </UiBadge>
      ))}
      {hiddenCount > 0 && (
        <UiBadge tone="white" size="xs" className="px-1.5 text-[10px]">
          +{hiddenCount}
        </UiBadge>
      )}
    </div>
  );
}

export function TaskTableView({
  visibleTasks,
  profiles,
  sprints,
  relations,
  allTasks,
  blockers,
  filters,
  canChangeTaskStatus,
  statusOptionsForTask,
  onOpenTask,
  onUpdateTask,
  onFiltersChange,
}: TaskTableViewProps) {
  const sortKeys: TaskTableSort[] = ["title", "status", "assignee", "priority", "sprint", "start", "deadline"];
  const sortKey: TaskTableSort = sortKeys.includes(filters.sort as TaskTableSort) ? filters.sort as TaskTableSort : "priority";
  const { rows: sortedTasks } = buildTaskTableViewModel({ tasks: visibleTasks, profiles, sprints, filters: { sort: sortKey, direction: filters.direction } });
  const toggleSort = (key: TaskTableSort) => onFiltersChange({ ...filters, sort: key, direction: sortKey === key && filters.direction === "asc" ? "desc" : "asc" });
  const directionFor = (key: TaskTableSort): SortDirection => sortKey === key ? filters.direction : null;
  const statusOptions = [{ value: "Alle", label: "Alle Status" }, ...Array.from(new Set(allTasks.map((task) => normalizeStatus(task.status)))).map((status) => ({ value: status, label: status }))];
  const assigneeOptions = [{ value: "Alle", label: "Alle Zuständigen" }, ...profiles.map((profile) => ({ value: profile.id, label: profile.name }))];
  const priorityOptions = ["Alle", "P0", "P1", "P2", "P3", "P4"].map((priority) => ({ value: priority, label: priority === "Alle" ? "Alle Prioritäten" : priority }));
  const sprintOptions = [{ value: "Alle", label: "Alle Sprints" }, ...sprints.map((sprint) => ({ value: sprint.id, label: sprint.name }))];
  const riskOptions = [{ value: "Alle", label: "Alle Risiken" }, { value: "critical", label: "Kritisch" }, { value: "blocked", label: "Blockiert" }, { value: "evidence", label: "Evidence fehlt" }, { value: "github", label: "GitHub fehlt" }];

  return (
    <DataTableFrame title="Aufgaben" description={`Sortiert nach ${sortKey === "priority" ? "Priorität" : sortKey === "title" ? "Aufgabe" : sortKey === "assignee" ? "Zuständigkeit" : sortKey === "sprint" ? "Sprint" : sortKey === "start" ? "Zeitraum" : sortKey === "deadline" ? "Zieltermin" : "Status"}`} caption="Gefilterte Planungsaufgaben" results={[{ id: "tasks", visibleCount: visibleTasks.length, totalCount: allTasks.filter((task) => task.taskType !== "sub_issue").length }]} filtering={{ mode: "external", labelledBy: "planning-data-filters" }} minWidth={1040}>
        <DataTableHead>
          <tr>
            <DataColumnHeader label="Aufgabe" direction={directionFor("title")} onSort={() => toggleSort("title")} sticky />
            <DataColumnHeader label="Status" direction={directionFor("status")} onSort={() => toggleSort("status")} filter={<ColumnFilterPopover label="Aufgaben nach Status filtern" activeCount={filters.status === "Alle" ? 0 : 1} onReset={() => onFiltersChange({ ...filters, status: "Alle" })}><CustomSelect aria-label="Status wählen" value={filters.status} onChange={(status) => onFiltersChange({ ...filters, status })} options={statusOptions} className="h-10" /></ColumnFilterPopover>} />
            <DataColumnHeader label="Zuständig" direction={directionFor("assignee")} onSort={() => toggleSort("assignee")} filter={<ColumnFilterPopover label="Aufgaben nach Zuständigkeit filtern" activeCount={filters.assignee === "Alle" ? 0 : 1} onReset={() => onFiltersChange({ ...filters, assignee: "Alle" })}><CustomSelect aria-label="Zuständigkeit wählen" value={filters.assignee} onChange={(assignee) => onFiltersChange({ ...filters, assignee })} options={assigneeOptions} className="h-10" /></ColumnFilterPopover>} />
            <DataColumnHeader label="Priorität" direction={directionFor("priority")} onSort={() => toggleSort("priority")} filter={<ColumnFilterPopover label="Aufgaben nach Priorität filtern" activeCount={filters.priority === "Alle" ? 0 : 1} onReset={() => onFiltersChange({ ...filters, priority: "Alle" })}><CustomSelect aria-label="Priorität wählen" value={filters.priority} onChange={(priority) => onFiltersChange({ ...filters, priority })} options={priorityOptions} className="h-10" /></ColumnFilterPopover>} />
            <DataColumnHeader label="Sprint" direction={directionFor("sprint")} onSort={() => toggleSort("sprint")} filter={<ColumnFilterPopover label="Aufgaben nach Sprint filtern" activeCount={filters.sprintId === "Alle" ? 0 : 1} onReset={() => onFiltersChange({ ...filters, sprintId: "Alle" })}><CustomSelect aria-label="Sprint wählen" value={filters.sprintId} onChange={(sprintId) => onFiltersChange({ ...filters, sprintId })} options={sprintOptions} className="h-10" /></ColumnFilterPopover>} />
            <DataColumnHeader label="Zeitraum" direction={directionFor("start")} onSort={() => toggleSort("start")} />
            <DataColumnHeader label="Zieltermin" direction={directionFor("deadline")} onSort={() => toggleSort("deadline")} filter={<ColumnFilterPopover label="Aufgaben nach Zieltermin filtern" activeCount={(filters.targetFrom ? 1 : 0) + (filters.targetTo ? 1 : 0)} onReset={() => onFiltersChange({ ...filters, targetFrom: "", targetTo: "" })}><div className="grid gap-3"><CustomDatePicker aria-label="Zieltermin von" value={filters.targetFrom} onChange={(targetFrom) => onFiltersChange({ ...filters, targetFrom })} className="h-10" /><CustomDatePicker aria-label="Zieltermin bis" value={filters.targetTo} onChange={(targetTo) => onFiltersChange({ ...filters, targetTo })} className="h-10" /></div></ColumnFilterPopover>} />
            <DataColumnHeader label="Risiko" filter={<ColumnFilterPopover label="Aufgaben nach Risiko filtern" activeCount={filters.risk === "Alle" ? 0 : 1} onReset={() => onFiltersChange({ ...filters, risk: "Alle" })}><CustomSelect aria-label="Risiko wählen" value={filters.risk} onChange={(risk) => onFiltersChange({ ...filters, risk })} options={riskOptions} className="h-10" /></ColumnFilterPopover>} />
          </tr>
        </DataTableHead>
        <tbody>
          {sortedTasks.map((task) => {
            const canUpdateStatus = canChangeTaskStatus(task);
            return (
              <DataRow key={task.id}>
                <DataCell className="max-w-sm" sticky>
                  <TaskReferenceLink task={task} onOpenTask={onOpenTask} className="items-start text-left font-semibold text-slate-900">
                    <span>{task.title}</span>
                  </TaskReferenceLink>
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
                  <CustomSelect aria-label={`Zuständigkeit für ${task.title} ändern`} value={task.assigneeId || task.assignee} onChange={(value) => onUpdateTask(task, { assignee: value, assigneeId: value })} className="h-8 w-36 text-xs" options={taskAssigneeOptions(task.taskType, profiles)} />
                </DataCell>
                <DataCell><UiBadge tone={priorityBadgeTone(task.priority)}>{task.priority}</UiBadge></DataCell>
                <DataCell>
                  <CustomSelect aria-label={`Sprint für ${task.title} ändern`} value={task.sprintId} onChange={(value) => onUpdateTask(task, { sprintId: value })} className="h-8 w-36 text-xs" options={[{ value: "", label: "Ohne Sprint" }, ...sprints.map((sprint) => ({ value: sprint.id, label: sprint.name }))]} />
                </DataCell>
                <DataCell>{dateRange(task)}</DataCell>
                <DataCell>{task.deadline}</DataCell>
                <DataCell className="max-w-52">
                  <TaskTableRiskBadges task={task} relations={relations} allTasks={allTasks} blockers={blockers} />
                </DataCell>
              </DataRow>
            );
          })}
          {!visibleTasks.length && (
            <DataEmptyRow colSpan={8}>
              {allTasks.some((task) => task.taskType !== "sub_issue") ? "Keine Aufgaben für diese Filter." : "Noch keine Aufgaben vorhanden."}
            </DataEmptyRow>
          )}
        </tbody>
    </DataTableFrame>
  );
}
