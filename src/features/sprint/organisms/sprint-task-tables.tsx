"use client";

import { useState } from "react";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { TaskReferenceLink } from "@/features/tasks/atoms/task-reference-link";
import { TaskStatusControl } from "@/features/tasks/atoms/task-status-control";
import { GitHubMissingBadge } from "@/features/tasks/molecules/task-card";
import { taskAssigneeLabel } from "@/lib/display";
import { hasGitHubIssue, reviewLabel } from "@/lib/platform";
import { normalizeStatus, taskStatuses } from "@/lib/status";
import type { PlanningData, Sprint, Task, TaskStatus } from "@/lib/types";
import { UiBadge, UiButton } from "@/shared/atoms/ui-primitives";
import { DataCell, DataEmptyRow, DataHeaderCell, DataOverflow, DataRow, DataSurface, DataTable, DataTableHead } from "@/shared/molecules/data-surface";
import { FilterField, FilterToolbar, type ActiveFilter } from "@/shared/molecules/filter-toolbar";

type SprintTaskRiskFilter = "all" | "github" | "carryover" | "outcome";
type SprintTaskSort = "priority" | "title" | "status" | "assignee";

export function SprintTaskTables({
  data,
  sprint,
  sprintTasks,
  otherTasks,
  pending,
  canManageFinalTaskStatus,
  canReviewTask,
  reviewOwnerName,
  isSelfReview,
  onOpenTask,
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
  canManageFinalTaskStatus: boolean;
  canReviewTask: (task: Task) => boolean;
  reviewOwnerName: (task: Task) => string;
  isSelfReview: (task: Task) => boolean;
  onOpenTask: (taskId: string) => void;
  onRequestReview: (task: Task) => void;
  onChangeStatus: (task: Task, status: TaskStatus) => void;
  onAssignSprint: (task: Task, sprintId: string) => void;
  onSelectReviewTask: (taskId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("Alle");
  const [assigneeFilter, setAssigneeFilter] = useState("Alle");
  const [riskFilter, setRiskFilter] = useState<SprintTaskRiskFilter>("all");
  const [sort, setSort] = useState<SprintTaskSort>("priority");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const normalizedQuery = query.trim().toLocaleLowerCase("de");
  const priorityRank: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
  const filterTasks = (tasks: Task[]) => tasks.filter((task) => {
    const queryMatches = !normalizedQuery || [task.title, task.description, task.assignee, task.workstream, task.priority].join(" ").toLocaleLowerCase("de").includes(normalizedQuery);
    const statusMatches = statusFilter === "Alle" || normalizeStatus(task.status) === statusFilter;
    const assigneeMatches = assigneeFilter === "Alle" || task.assigneeId === assigneeFilter || task.assignee === assigneeFilter;
    const riskMatches = riskFilter === "all"
      || riskFilter === "github" && !hasGitHubIssue(task)
      || riskFilter === "carryover" && Boolean(task.carriedFromSprintId)
      || riskFilter === "outcome" && Boolean(task.sprintOutcome);
    return queryMatches && statusMatches && assigneeMatches && riskMatches;
  }).sort((left, right) => {
    if (sort === "title") return left.title.localeCompare(right.title, "de");
    if (sort === "status") return normalizeStatus(left.status).localeCompare(normalizeStatus(right.status), "de") || left.order - right.order;
    if (sort === "assignee") return (left.assignee || "").localeCompare(right.assignee || "", "de") || left.order - right.order;
    return (priorityRank[left.priority] ?? 9) - (priorityRank[right.priority] ?? 9) || left.order - right.order;
  });
  const visibleSprintTasks = filterTasks(sprintTasks);
  const visibleOtherTasks = filterTasks(otherTasks);
  const activeFilters: ActiveFilter[] = [
    ...(statusFilter !== "Alle" ? [{ id: "status", label: `Status: ${statusFilter}`, onRemove: () => setStatusFilter("Alle") }] : []),
    ...(assigneeFilter !== "Alle" ? [{ id: "assignee", label: `Zuständig: ${data.profiles.find((profile) => profile.id === assigneeFilter)?.name || assigneeFilter}`, onRemove: () => setAssigneeFilter("Alle") }] : []),
    ...(riskFilter !== "all" ? [{ id: "risk", label: `Risiko: ${riskFilter === "github" ? "GitHub fehlt" : riskFilter === "carryover" ? "Carry-over" : "Sprint-Ergebnis"}`, onRemove: () => setRiskFilter("all") }] : []),
    ...(sort !== "priority" ? [{ id: "sort", label: `Sortierung: ${sort === "title" ? "Titel" : sort === "status" ? "Status" : "Zuständigkeit"}`, onRemove: () => setSort("priority") }] : []),
  ];
  const resetFilters = () => {
    setQuery("");
    setStatusFilter("Alle");
    setAssigneeFilter("Alle");
    setRiskFilter("all");
    setSort("priority");
  };

  return (
    <>
      <FilterToolbar
        searchLabel="Sprint-Aufgaben durchsuchen"
        searchPlaceholder="Aufgabe, Bereich oder Zuständigkeit suchen"
        query={query}
        onQueryChange={setQuery}
        expanded={filtersOpen}
        onExpandedChange={setFiltersOpen}
        activeFilters={activeFilters}
        onReset={resetFilters}
        visibleCount={visibleSprintTasks.length}
        totalCount={sprintTasks.length}
        panelId="sprint-task-filters"
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <FilterField label="Status"><CustomSelect aria-label="Sprint-Aufgaben nach Status filtern" value={statusFilter} onChange={setStatusFilter} className="h-10 text-sm" options={[{ value: "Alle", label: "Alle Status" }, ...taskStatuses.map((status) => ({ value: status, label: status }))]} /></FilterField>
          <FilterField label="Zuständig"><CustomSelect aria-label="Sprint-Aufgaben nach Zuständigkeit filtern" value={assigneeFilter} onChange={setAssigneeFilter} className="h-10 text-sm" options={[{ value: "Alle", label: "Alle Zuständigen" }, ...data.profiles.map((profile) => ({ value: profile.id, label: profile.name }))]} /></FilterField>
          <FilterField label="Risiko"><CustomSelect aria-label="Sprint-Aufgaben nach Risiko filtern" value={riskFilter} onChange={(value) => setRiskFilter(value as SprintTaskRiskFilter)} className="h-10 text-sm" options={[{ value: "all", label: "Alle Risiken" }, { value: "github", label: "GitHub fehlt" }, { value: "carryover", label: "Carry-over" }, { value: "outcome", label: "Sprint-Ergebnis gesetzt" }]} /></FilterField>
          <FilterField label="Sortierung"><CustomSelect aria-label="Sprint-Aufgaben sortieren" value={sort} onChange={(value) => setSort(value as SprintTaskSort)} className="h-10 text-sm" options={[{ value: "priority", label: "Priorität" }, { value: "title", label: "Titel" }, { value: "status", label: "Status" }, { value: "assignee", label: "Zuständigkeit" }]} /></FilterField>
        </div>
      </FilterToolbar>
      <DataSurface title="Sprint-Aufgaben">
        <DataOverflow>
          <DataTable minWidth={940}>
            <DataTableHead>
              <tr>
                <DataHeaderCell className="px-4">Aufgabe</DataHeaderCell>
                <DataHeaderCell>Zuständig</DataHeaderCell>
                <DataHeaderCell>Status / Review</DataHeaderCell>
                <DataHeaderCell>Score</DataHeaderCell>
                <DataHeaderCell>Risiko</DataHeaderCell>
                <DataHeaderCell>Nächster Schritt</DataHeaderCell>
              </tr>
            </DataTableHead>
            <tbody>
              {visibleSprintTasks.map((task) => (
                <DataRow key={task.id}>
                  <DataCell className="max-w-[360px] px-4">
                    <TaskReferenceLink task={task} onOpenTask={onOpenTask} className="max-w-full text-left font-semibold text-slate-950">
                      <span className="truncate">{task.title}</span>
                    </TaskReferenceLink>
                  </DataCell>
                  <DataCell className="text-slate-700">{taskAssigneeLabel(task)}</DataCell>
                  <DataCell>
                    <TaskStatusControl
                      status={task.status}
                      canChange={!pending && (canManageFinalTaskStatus || normalizeStatus(task.status) !== "Erledigt")}
                      onChange={(status) => onChangeStatus(task, status)}
                      options={canManageFinalTaskStatus ? taskStatuses : taskStatuses.filter((status) => status !== "Erledigt")}
                      selectClassName="h-8 w-32 text-xs font-semibold"
                      compact
                    />
                    <div className="mt-2 text-xs text-slate-600">{reviewLabel(task.reviewStatus)}</div>
                    <div className="mt-1 text-xs text-slate-500">{reviewOwnerName(task)}{isSelfReview(task) ? " · Self-Review" : ""}</div>
                  </DataCell>
                  <DataCell className="text-slate-700">
                    {task.scorePoints} {task.scoreFinal ? "final" : "offen"}
                  </DataCell>
                  <DataCell>
                    <div className="flex flex-wrap gap-1">
                      {!hasGitHubIssue(task) && <GitHubMissingBadge />}
                      {task.carriedFromSprintId && <UiBadge tone="blue" size="xs" className="text-[11px]">Carry-over</UiBadge>}
                      {task.sprintOutcome && <UiBadge tone="slate" size="xs" className="text-[11px]">{task.sprintOutcome}</UiBadge>}
                      {hasGitHubIssue(task) && !task.carriedFromSprintId && !task.sprintOutcome && <span className="text-xs text-slate-400">-</span>}
                    </div>
                  </DataCell>
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
              {!visibleSprintTasks.length && (
                <DataEmptyRow colSpan={6}>
                  Keine Sprint-Aufgaben für diese Filter.
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
                {visibleOtherTasks.map((task) => {
                  const currentSprint = data.sprints.find((item) => item.id === task.sprintId);
                  return (
                    <DataRow key={task.id}>
                      <DataCell className="max-w-[420px] px-4">
                        <TaskReferenceLink task={task} onOpenTask={onOpenTask} className="max-w-full text-left font-semibold text-slate-950">
                          {task.title}
                        </TaskReferenceLink>
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
                {!visibleOtherTasks.length && <DataEmptyRow colSpan={4}>Keine Aufgaben aus anderen Sprints für diese Filter.</DataEmptyRow>}
              </tbody>
            </DataTable>
          </DataOverflow>
        </DataSurface>
      )}
    </>
  );
}
