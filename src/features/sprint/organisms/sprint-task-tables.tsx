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
import { buildSprintTaskTableRows, DEFAULT_SPRINT_TASK_FILTERS, type SprintTaskReviewFilter, type SprintTaskRiskFilter, type SprintTaskScoreFilter, type SprintTaskSort, type SprintTaskTableFilters } from "@/features/sprint/model/sprint-task-table-view-model";
import { ColumnFilterPopover } from "@/shared/molecules/column-filter-popover";
import { DataCell, DataColumnHeader, DataEmptyRow, DataHeaderCell, DataRow, DataTableFrame, DataTableHead, type SortDirection } from "@/shared/molecules/data-surface";
import { FilterField, FilterToolbar, type ActiveFilter } from "@/shared/molecules/filter-toolbar";
import { enumUrlField, stringUrlField, useTableUrlState, type TableUrlSchema } from "@/shared/hooks/use-table-url-state";

const sprintTaskFilterSchema: TableUrlSchema<SprintTaskTableFilters> = {
  query: stringUrlField(),
  status: stringUrlField("Alle"),
  assignee: stringUrlField("Alle"),
  risk: enumUrlField("all", ["all", "github", "carryover", "outcome"] as const),
  review: enumUrlField("all", ["all", "not_requested", "requested", "changes_requested", "accepted", "partial"] as const),
  score: enumUrlField("all", ["all", "open", "final"] as const),
  sort: enumUrlField("priority", ["priority", "title", "status", "assignee", "sprint", "score"] as const),
  direction: enumUrlField("asc", ["asc", "desc"] as const),
};

export function SprintTaskTables({
  data,
  sprint,
  sprintTasks,
  otherTasks,
  pending,
  canManageFinalTaskStatus,
  reviewOwnerName,
  isSelfReview,
  onOpenTask,
  onRequestReview,
  onChangeStatus,
  onAssignSprint,
  onOpenReviewTask,
}: {
  data: PlanningData;
  sprint: Sprint;
  sprintTasks: Task[];
  otherTasks: Task[];
  pending: boolean;
  canManageFinalTaskStatus: boolean;
  reviewOwnerName: (task: Task) => string;
  isSelfReview: (task: Task) => boolean;
  onOpenTask: (taskId: string) => void;
  onRequestReview: (task: Task) => void;
  onChangeStatus: (task: Task, status: TaskStatus) => void;
  onAssignSprint: (task: Task, sprintId: string) => void;
  onOpenReviewTask: (taskId: string) => void;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { state: filters, updateState: updateFilters, resetState: resetFilters } = useTableUrlState({ namespace: "sprintTasks", schema: sprintTaskFilterSchema });
  const visibleSprintTasks = buildSprintTaskTableRows(sprintTasks, data, filters);
  const visibleOtherTasks = buildSprintTaskTableRows(otherTasks, data, filters);
  const reviewLabels: Record<SprintTaskReviewFilter, string> = { all: "Alle Reviews", not_requested: "Nicht angefragt", requested: "Angefragt", accepted: "Akzeptiert", partial: "Kleine Nacharbeit", changes_requested: "Grundlegend überarbeiten" };
  const scoreLabels: Record<SprintTaskScoreFilter, string> = { all: "Alle Scores", open: "Score offen", final: "Score final" };
  const activeFilters: ActiveFilter[] = [
    ...(filters.status !== "Alle" ? [{ id: "status", label: `Status: ${filters.status}`, onRemove: () => updateFilters({ status: "Alle" }) }] : []),
    ...(filters.assignee !== "Alle" ? [{ id: "assignee", label: `Zuständig: ${data.profiles.find((profile) => profile.id === filters.assignee)?.name || filters.assignee}`, onRemove: () => updateFilters({ assignee: "Alle" }) }] : []),
    ...(filters.risk !== "all" ? [{ id: "risk", label: `Risiko: ${filters.risk === "github" ? "GitHub fehlt" : filters.risk === "carryover" ? "Carry-over" : "Sprint-Ergebnis"}`, onRemove: () => updateFilters({ risk: "all" }) }] : []),
    ...(filters.review !== "all" ? [{ id: "review", label: `Review: ${reviewLabels[filters.review]}`, onRemove: () => updateFilters({ review: "all" }) }] : []),
    ...(filters.score !== "all" ? [{ id: "score", label: scoreLabels[filters.score], onRemove: () => updateFilters({ score: "all" }) }] : []),
  ];
  const toggleSort = (sort: SprintTaskSort) => updateFilters({ sort, direction: filters.sort === sort && filters.direction === "asc" ? "desc" : "asc" });
  const directionFor = (sort: SprintTaskSort): SortDirection => filters.sort === sort ? filters.direction : null;
  const statusOptions = [{ value: "Alle", label: "Alle Status" }, ...taskStatuses.map((status) => ({ value: status, label: status }))];
  const assigneeOptions = [{ value: "Alle", label: "Alle Zuständigen" }, ...data.profiles.map((profile) => ({ value: profile.id, label: profile.name }))];
  const riskOptions = [{ value: "all", label: "Alle Risiken" }, { value: "github", label: "GitHub fehlt" }, { value: "carryover", label: "Carry-over" }, { value: "outcome", label: "Sprint-Ergebnis gesetzt" }];
  const reviewOptions = (Object.keys(reviewLabels) as SprintTaskReviewFilter[]).map((value) => ({ value, label: reviewLabels[value] }));
  const scoreOptions = (Object.keys(scoreLabels) as SprintTaskScoreFilter[]).map((value) => ({ value, label: scoreLabels[value] }));

  return (
    <>
      <FilterToolbar
        searchLabel="Sprint-Aufgaben durchsuchen"
        searchPlaceholder="Aufgabe, Bereich oder Zuständigkeit suchen"
        query={filters.query}
        onQueryChange={(query) => updateFilters({ query }, "replace")}
        expanded={filtersOpen}
        onExpandedChange={setFiltersOpen}
        activeFilters={activeFilters}
        isDirty={JSON.stringify(filters) !== JSON.stringify(DEFAULT_SPRINT_TASK_FILTERS)}
        onReset={resetFilters}
        results={[
          { id: "sprint", label: "Sprint", visibleCount: visibleSprintTasks.length, totalCount: sprintTasks.length },
          { id: "other", label: "Andere", visibleCount: visibleOtherTasks.length, totalCount: otherTasks.length },
        ]}
        panelId="sprint-task-filters"
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          <FilterField label="Status"><CustomSelect aria-label="Sprint-Aufgaben nach Status filtern" value={filters.status} onChange={(status) => updateFilters({ status })} className="h-10 text-sm" options={statusOptions} /></FilterField>
          <FilterField label="Zuständig"><CustomSelect aria-label="Sprint-Aufgaben nach Zuständigkeit filtern" value={filters.assignee} onChange={(assignee) => updateFilters({ assignee })} className="h-10 text-sm" options={assigneeOptions} /></FilterField>
          <FilterField label="Risiko"><CustomSelect aria-label="Sprint-Aufgaben nach Risiko filtern" value={filters.risk} onChange={(risk) => updateFilters({ risk: risk as SprintTaskRiskFilter })} className="h-10 text-sm" options={riskOptions} /></FilterField>
          <FilterField label="Review"><CustomSelect aria-label="Sprint-Aufgaben nach Review filtern" value={filters.review} onChange={(review) => updateFilters({ review: review as SprintTaskReviewFilter })} className="h-10 text-sm" options={reviewOptions} /></FilterField>
          <FilterField label="Score"><CustomSelect aria-label="Sprint-Aufgaben nach Score filtern" value={filters.score} onChange={(score) => updateFilters({ score: score as SprintTaskScoreFilter })} className="h-10 text-sm" options={scoreOptions} /></FilterField>
        </div>
      </FilterToolbar>
      <DataTableFrame title="Sprint-Aufgaben" caption="Aufgaben im ausgewählten Sprint" results={[{ id: "sprint", visibleCount: visibleSprintTasks.length, totalCount: sprintTasks.length }]} filtering={{ mode: "external", labelledBy: "sprint-task-filters" }} minWidth={940}>
            <DataTableHead>
              <tr>
                <DataColumnHeader className="px-4" label="Aufgabe" direction={directionFor("title")} onSort={() => toggleSort("title")} sticky />
                <DataColumnHeader label="Zuständig" direction={directionFor("assignee")} onSort={() => toggleSort("assignee")} filter={<ColumnFilterPopover label="Sprint-Aufgaben nach Zuständigkeit filtern" activeCount={filters.assignee === "Alle" ? 0 : 1} onReset={() => updateFilters({ assignee: "Alle" })}><CustomSelect aria-label="Zuständigkeit wählen" value={filters.assignee} onChange={(assignee) => updateFilters({ assignee })} options={assigneeOptions} className="h-10" /></ColumnFilterPopover>} />
                <DataColumnHeader label="Status / Review" direction={directionFor("status")} onSort={() => toggleSort("status")} filter={<ColumnFilterPopover label="Sprint-Aufgaben nach Status und Review filtern" activeCount={(filters.status === "Alle" ? 0 : 1) + (filters.review === "all" ? 0 : 1)} onReset={() => updateFilters({ status: "Alle", review: "all" })}><div className="grid gap-3"><CustomSelect aria-label="Status wählen" value={filters.status} onChange={(status) => updateFilters({ status })} options={statusOptions} className="h-10" /><CustomSelect aria-label="Review wählen" value={filters.review} onChange={(review) => updateFilters({ review: review as SprintTaskReviewFilter })} options={reviewOptions} className="h-10" /></div></ColumnFilterPopover>} />
                <DataColumnHeader label="Score" direction={directionFor("score")} onSort={() => toggleSort("score")} filter={<ColumnFilterPopover label="Sprint-Aufgaben nach Score filtern" activeCount={filters.score === "all" ? 0 : 1} onReset={() => updateFilters({ score: "all" })}><CustomSelect aria-label="Score wählen" value={filters.score} onChange={(score) => updateFilters({ score: score as SprintTaskScoreFilter })} options={scoreOptions} className="h-10" /></ColumnFilterPopover>} />
                <DataColumnHeader label="Risiko" filter={<ColumnFilterPopover label="Sprint-Aufgaben nach Risiko filtern" activeCount={filters.risk === "all" ? 0 : 1} onReset={() => updateFilters({ risk: "all" })}><CustomSelect aria-label="Risiko wählen" value={filters.risk} onChange={(risk) => updateFilters({ risk: risk as SprintTaskRiskFilter })} options={riskOptions} className="h-10" /></ColumnFilterPopover>} />
                <DataHeaderCell>Nächster Schritt</DataHeaderCell>
              </tr>
            </DataTableHead>
            <tbody>
              {visibleSprintTasks.map((task) => (
                <DataRow key={task.id}>
                  <DataCell className="max-w-[360px] px-4" sticky>
                    <TaskReferenceLink task={task} onOpenTask={onOpenTask} className="max-w-full text-left font-semibold text-slate-950">
                      <span className="truncate">{task.title}</span>
                    </TaskReferenceLink>
                  </DataCell>
                  <DataCell className="text-slate-700">{taskAssigneeLabel(task)}</DataCell>
                  <DataCell>
                    <TaskStatusControl
                      status={task.status}
                      canChange={!pending && task.reviewStatus !== "requested" && (canManageFinalTaskStatus || normalizeStatus(task.status) !== "Erledigt")}
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
                      {task.reviewStatus === "requested" || normalizeStatus(task.status) === "Review" ? (
                        <UiButton
                          type="button"
                          disabled={pending}
                          onClick={() => onOpenReviewTask(task.id)}
                          variant="blue"
                          size="xs"
                        >
                          Review öffnen
                        </UiButton>
                      ) : null}
                    </div>
                  </DataCell>
                </DataRow>
              ))}
              {!visibleSprintTasks.length && (
                <DataEmptyRow colSpan={6}>
                  {sprintTasks.length ? "Keine Sprint-Aufgaben für diese Filter." : "Noch keine Aufgaben in diesem Sprint."}
                </DataEmptyRow>
              )}
            </tbody>
      </DataTableFrame>

      {otherTasks.length > 0 && (
        <DataTableFrame title="Backlog und andere Sprints" description="Nicht im ausgewählten Sprint." caption="Aufgaben außerhalb des ausgewählten Sprints" results={[{ id: "other", visibleCount: visibleOtherTasks.length, totalCount: otherTasks.length }]} filtering={{ mode: "external", labelledBy: "sprint-task-filters" }} minWidth={840}>
              <DataTableHead>
                <tr>
                  <DataColumnHeader className="px-4" label="Aufgabe" direction={directionFor("title")} onSort={() => toggleSort("title")} sticky />
                  <DataColumnHeader label="Zuständig" direction={directionFor("assignee")} onSort={() => toggleSort("assignee")} filter={<ColumnFilterPopover label="Andere Aufgaben nach Zuständigkeit filtern" activeCount={filters.assignee === "Alle" ? 0 : 1} onReset={() => updateFilters({ assignee: "Alle" })}><CustomSelect aria-label="Zuständigkeit wählen" value={filters.assignee} onChange={(assignee) => updateFilters({ assignee })} options={assigneeOptions} className="h-10" /></ColumnFilterPopover>} />
                  <DataColumnHeader label="Aktueller Sprint" direction={directionFor("sprint")} onSort={() => toggleSort("sprint")} />
                  <DataHeaderCell>Zuweisung</DataHeaderCell>
                </tr>
              </DataTableHead>
              <tbody>
                {visibleOtherTasks.map((task) => {
                  const currentSprint = data.sprints.find((item) => item.id === task.sprintId);
                  return (
                    <DataRow key={task.id}>
                      <DataCell className="max-w-[420px] px-4" sticky>
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
                {!visibleOtherTasks.length && <DataEmptyRow colSpan={4}>{otherTasks.length ? "Keine Aufgaben aus anderen Sprints für diese Filter." : "Noch keine Aufgaben aus anderen Sprints vorhanden."}</DataEmptyRow>}
              </tbody>
        </DataTableFrame>
      )}
    </>
  );
}
