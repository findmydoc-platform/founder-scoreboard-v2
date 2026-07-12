"use client";

import { useState } from "react";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { TaskReferenceLink } from "@/features/tasks/atoms/task-reference-link";
import { TaskStatusControl } from "@/features/tasks/atoms/task-status-control";
import { taskPlanningAttentionSignals, type TaskAttentionSignal } from "@/features/tasks/model/task-attention-signals";
import { dateRange, taskAssigneeOptions } from "@/lib/display";
import { hasGitHubIssue, hasOpenWaitingRelation, taskRelationsFor } from "@/lib/platform";
import { normalizeStatus, priorityBadgeTone } from "@/lib/status";
import type { Profile, Sprint, Task, TaskBlocker, TaskRelation, TaskStatus } from "@/lib/types";
import { UiBadge, type UiTone } from "@/shared/atoms/ui-primitives";
import { DataCell, DataEmptyRow, DataHeaderCell, DataOverflow, DataRow, DataSurface, DataTable, DataTableHead, SortableDataHeaderCell, type SortDirection } from "@/shared/molecules/data-surface";

type TaskTableViewProps = {
  visibleTasks: Task[];
  profiles: Profile[];
  sprints: Sprint[];
  relations: TaskRelation[];
  allTasks: Task[];
  blockers: TaskBlocker[];
  canChangeTaskStatus: (task: Task) => boolean;
  statusOptionsForTask: (task: Task) => TaskStatus[];
  onOpenTask: (taskId: string) => void;
  onUpdateTask: (task: Task, patch: Partial<Task>) => void;
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
  canChangeTaskStatus,
  statusOptionsForTask,
  onOpenTask,
  onUpdateTask,
}: TaskTableViewProps) {
  type SortKey = "title" | "status" | "assignee" | "priority" | "sprint" | "start" | "deadline";
  const [sortKey, setSortKey] = useState<SortKey>("priority");
  const [sortDirection, setSortDirection] = useState<Exclude<SortDirection, null>>("asc");
  const sprintName = (task: Task) => sprints.find((sprint) => sprint.id === task.sprintId)?.name || "";
  const priorityRank: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
  const sortedTasks = [...visibleTasks].sort((left, right) => {
    const values: Record<SortKey, [string | number, string | number]> = {
      title: [left.title, right.title],
      status: [normalizeStatus(left.status), normalizeStatus(right.status)],
      assignee: [taskAssigneeOptions(left.taskType, profiles).find((option) => option.value === (left.assigneeId || left.assignee))?.label || left.assignee, taskAssigneeOptions(right.taskType, profiles).find((option) => option.value === (right.assigneeId || right.assignee))?.label || right.assignee],
      priority: [priorityRank[left.priority] ?? 9, priorityRank[right.priority] ?? 9],
      sprint: [sprintName(left), sprintName(right)],
      start: [left.startDate || "", right.startDate || ""],
      deadline: [left.deadline || left.endDate || "", right.deadline || right.endDate || ""],
    };
    const [leftValue, rightValue] = values[sortKey];
    const comparison = typeof leftValue === "number" && typeof rightValue === "number"
      ? leftValue - rightValue
      : String(leftValue).localeCompare(String(rightValue), "de");
    return (sortDirection === "asc" ? comparison : -comparison) || left.order - right.order;
  });
  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setSortDirection("asc");
    }
  };
  const directionFor = (key: SortKey): SortDirection => sortKey === key ? sortDirection : null;

  return (
    <DataSurface title="Aufgaben" description={`${visibleTasks.length} Treffer · sortiert nach ${sortKey === "priority" ? "Priorität" : sortKey === "title" ? "Aufgabe" : sortKey === "assignee" ? "Zuständigkeit" : sortKey === "sprint" ? "Sprint" : sortKey === "start" ? "Zeitraum" : sortKey === "deadline" ? "Zieltermin" : "Status"}`}>
      <DataOverflow>
        <DataTable minWidth={1040}>
        <DataTableHead>
          <tr>
            <SortableDataHeaderCell label="Aufgabe" direction={directionFor("title")} onSort={() => toggleSort("title")} />
            <SortableDataHeaderCell label="Status" direction={directionFor("status")} onSort={() => toggleSort("status")} />
            <SortableDataHeaderCell label="Zuständig" direction={directionFor("assignee")} onSort={() => toggleSort("assignee")} />
            <SortableDataHeaderCell label="Priorität" direction={directionFor("priority")} onSort={() => toggleSort("priority")} />
            <SortableDataHeaderCell label="Sprint" direction={directionFor("sprint")} onSort={() => toggleSort("sprint")} />
            <SortableDataHeaderCell label="Zeitraum" direction={directionFor("start")} onSort={() => toggleSort("start")} />
            <SortableDataHeaderCell label="Zieltermin" direction={directionFor("deadline")} onSort={() => toggleSort("deadline")} />
            <DataHeaderCell>Risiko</DataHeaderCell>
          </tr>
        </DataTableHead>
        <tbody>
          {sortedTasks.map((task) => {
            const canUpdateStatus = canChangeTaskStatus(task);
            return (
              <DataRow key={task.id}>
                <DataCell className="max-w-sm">
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
              Keine Aufgaben in dieser Ansicht.
            </DataEmptyRow>
          )}
        </tbody>
        </DataTable>
      </DataOverflow>
    </DataSurface>
  );
}
