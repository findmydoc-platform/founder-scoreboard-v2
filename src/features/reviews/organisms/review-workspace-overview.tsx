"use client";

import { useState } from "react";
import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { UiLinkButton } from "@/shared/atoms/ui-primitives";
import { ReviewTaskAttentionBadges } from "@/features/tasks/molecules/task-attention-badges";
import { TaskReferenceLink } from "@/features/tasks/atoms/task-reference-link";
import { dateRange, taskAssigneeLabel } from "@/lib/display";
import { reviewLabel } from "@/lib/platform";
import { buildReviewWorkspaceViewModel, DEFAULT_REVIEW_FILTERS, isBlockedReviewTask, reviewStatusFilterOptions, type ReviewRiskFilter, type ReviewSort, type ReviewStatusFilter, type ReviewWorkspaceFilters } from "@/features/reviews/model/review-workspace-view-model";
import { normalizeStatus } from "@/lib/status";
import type { PlanningData, Profile } from "@/lib/types";
import { FilterField, FilterSegmentedControl, FilterToolbar, type ActiveFilter } from "@/shared/molecules/filter-toolbar";
import { ColumnFilterPopover } from "@/shared/molecules/column-filter-popover";
import { DataColumnHeader, DataEmptyRow, DataHeaderCell, DataTableFrame, DataTableHead, type SortDirection } from "@/shared/molecules/data-surface";
import { dateUrlField, enumUrlField, stringUrlField, useTableUrlState, type TableUrlSchema } from "@/shared/hooks/use-table-url-state";

type Props = {
  data: PlanningData;
  currentProfile: Profile | null;
  onOpenTask: (taskId: string) => void;
};

const reviewFilterSchema: TableUrlSchema<ReviewWorkspaceFilters> = {
  status: enumUrlField("open", ["open", "completed", "rework", "blocked", "all"] as const),
  owner: stringUrlField("all"),
  query: stringUrlField(),
  priority: stringUrlField("Alle"),
  assignee: stringUrlField("Alle"),
  risk: enumUrlField("all", ["all", "blocked", "critical"] as const),
  from: dateUrlField(),
  to: dateUrlField(),
  sort: enumUrlField("priority", ["priority", "title", "assignee", "owner", "status", "date"] as const),
  direction: enumUrlField("asc", ["asc", "desc"] as const),
};

export function ReviewWorkspaceOverview({
  data,
  currentProfile,
  onOpenTask,
}: Props) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { state: filters, updateState: updateFilters, resetState: resetFilters } = useTableUrlState({ namespace: "reviews", schema: reviewFilterSchema });
  const { visibleTasks, ownerOptions, metrics } = buildReviewWorkspaceViewModel({
    data,
    currentProfile,
    filters,
  });
  const profileName = (profileId = "") => data.profiles.find((profile) => profile.id === profileId)?.name || profileId || "Ohne Review Owner";
  const statusCounts: Record<ReviewStatusFilter, number> = {
    open: metrics.open,
    completed: metrics.completed,
    rework: metrics.rework,
    blocked: metrics.blocked,
    all: metrics.total,
  };
  const riskLabels: Record<ReviewRiskFilter, string> = { all: "Alle Risiken", blocked: "Geblockt", critical: "Kritisch" };
  const activeFilters: ActiveFilter[] = [
    ...(filters.status !== "open" ? [{ id: "status", label: `Review-Status: ${reviewStatusFilterOptions.find((option) => option.value === filters.status)?.label || filters.status}`, onRemove: () => updateFilters({ status: "open" }) }] : []),
    ...(filters.owner !== "all" ? [{ id: "owner", label: `Review Owner: ${ownerOptions.find((option) => option.value === filters.owner)?.label || filters.owner}`, onRemove: () => updateFilters({ owner: "all" }) }] : []),
    ...(filters.priority !== "Alle" ? [{ id: "priority", label: `Priorität: ${filters.priority}`, onRemove: () => updateFilters({ priority: "Alle" }) }] : []),
    ...(filters.assignee !== "Alle" ? [{ id: "assignee", label: `Zuständig: ${profileName(filters.assignee)}`, onRemove: () => updateFilters({ assignee: "Alle" }) }] : []),
    ...(filters.risk !== "all" ? [{ id: "risk", label: `Risiko: ${riskLabels[filters.risk]}`, onRemove: () => updateFilters({ risk: "all" }) }] : []),
    ...(filters.from ? [{ id: "from", label: `Ab: ${filters.from}`, onRemove: () => updateFilters({ from: "" }) }] : []),
    ...(filters.to ? [{ id: "to", label: `Bis: ${filters.to}`, onRemove: () => updateFilters({ to: "" }) }] : []),
  ];
  const toggleSort = (nextSort: ReviewSort) => {
    updateFilters({ sort: nextSort, direction: filters.sort === nextSort && filters.direction === "asc" ? "desc" : "asc" });
  };
  const directionFor = (key: ReviewSort): SortDirection => filters.sort === key ? filters.direction : null;
  const priorityOptions = ["Alle", "P0", "P1", "P2", "P3", "P4"].map((value) => ({ value, label: value === "Alle" ? "Alle Prioritäten" : value }));
  const assigneeOptions = [{ value: "Alle", label: "Alle Zuständigen" }, ...data.profiles.map((profile) => ({ value: profile.id, label: profile.name }))];
  const riskOptions = (Object.keys(riskLabels) as ReviewRiskFilter[]).map((value) => ({ value, label: riskLabels[value] }));
  const toolbar = (
    <FilterToolbar
      variant="embedded"
      searchLabel="Reviews durchsuchen"
      searchPlaceholder="Aufgabe, Zuständigkeit oder Review Owner suchen"
      query={filters.query}
      onQueryChange={(query) => updateFilters({ query }, "replace")}
      expanded={filtersOpen}
      onExpandedChange={setFiltersOpen}
      activeFilters={activeFilters}
      isDirty={JSON.stringify(filters) !== JSON.stringify(DEFAULT_REVIEW_FILTERS)}
      onReset={resetFilters}
      results={[{ id: "reviews", visibleCount: visibleTasks.length, totalCount: metrics.total }]}
      panelId="review-data-filters"
      primaryControls={<FilterSegmentedControl label="Review-Status" value={filters.status} options={reviewStatusFilterOptions.map((option) => ({ ...option, count: statusCounts[option.value] }))} onChange={(status) => updateFilters({ status })} />}
    >
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <FilterField label="Review Owner"><CustomSelect aria-label="Nach Review Owner filtern" value={filters.owner} onChange={(owner) => updateFilters({ owner })} className="h-10 text-sm" options={ownerOptions} /></FilterField>
        <FilterField label="Zuständig"><CustomSelect aria-label="Reviews nach Zuständigkeit filtern" value={filters.assignee} onChange={(assignee) => updateFilters({ assignee })} className="h-10 text-sm" options={assigneeOptions} /></FilterField>
        <FilterField label="Priorität"><CustomSelect aria-label="Reviews nach Priorität filtern" value={filters.priority} onChange={(priority) => updateFilters({ priority })} className="h-10 text-sm" options={priorityOptions} /></FilterField>
        <FilterField label="Risiko"><CustomSelect aria-label="Reviews nach Risiko filtern" value={filters.risk} onChange={(risk) => updateFilters({ risk: risk as ReviewRiskFilter })} className="h-10 text-sm" options={riskOptions} /></FilterField>
        <FilterField label="Von"><CustomDatePicker aria-label="Reviews ab Datum filtern" value={filters.from} onChange={(from) => updateFilters({ from })} className="h-10" /></FilterField>
        <FilterField label="Bis"><CustomDatePicker aria-label="Reviews bis Datum filtern" value={filters.to} onChange={(to) => updateFilters({ to })} className="h-10" /></FilterField>
      </div>
    </FilterToolbar>
  );

  return (
    <DataTableFrame title="Reviews" caption="Accountable Reviews" results={[{ id: "reviews", visibleCount: visibleTasks.length, totalCount: metrics.total }]} filtering={{ mode: "embedded", toolbar }} minWidth={860}>
            <DataTableHead>
              <tr>
                <DataColumnHeader className="px-4" label="Aufgabe" direction={directionFor("title")} onSort={() => toggleSort("title")} sticky />
                <DataColumnHeader label="Zuständig" direction={directionFor("assignee")} onSort={() => toggleSort("assignee")} filter={<ColumnFilterPopover label="Reviews nach Zuständigkeit filtern" activeCount={filters.assignee === "Alle" ? 0 : 1} onReset={() => updateFilters({ assignee: "Alle" })}><CustomSelect aria-label="Zuständigkeit wählen" value={filters.assignee} onChange={(assignee) => updateFilters({ assignee })} options={assigneeOptions} className="h-10" /></ColumnFilterPopover>} />
                <DataColumnHeader label="Review Owner" direction={directionFor("owner")} onSort={() => toggleSort("owner")} filter={<ColumnFilterPopover label="Reviews nach Review Owner filtern" activeCount={filters.owner === "all" ? 0 : 1} onReset={() => updateFilters({ owner: "all" })}><CustomSelect aria-label="Review Owner wählen" value={filters.owner} onChange={(owner) => updateFilters({ owner })} options={ownerOptions} className="h-10" /></ColumnFilterPopover>} />
                <DataColumnHeader label="Status" direction={directionFor("status")} onSort={() => toggleSort("status")} filter={<ColumnFilterPopover label="Reviews nach Status und Risiko filtern" activeCount={(filters.status === "open" ? 0 : 1) + (filters.risk === "all" ? 0 : 1)} onReset={() => updateFilters({ status: "open", risk: "all" })}><div className="grid gap-3"><CustomSelect aria-label="Review-Status wählen" value={filters.status} onChange={(status) => updateFilters({ status: status as ReviewWorkspaceFilters["status"] })} options={reviewStatusFilterOptions} className="h-10" /><CustomSelect aria-label="Review-Risiko wählen" value={filters.risk} onChange={(risk) => updateFilters({ risk: risk as ReviewRiskFilter })} options={riskOptions} className="h-10" /></div></ColumnFilterPopover>} />
                <DataColumnHeader label="Zeitraum" direction={directionFor("date")} onSort={() => toggleSort("date")} filter={<ColumnFilterPopover label="Reviews nach Zeitraum filtern" activeCount={(filters.from ? 1 : 0) + (filters.to ? 1 : 0)} onReset={() => updateFilters({ from: "", to: "" })}><div className="grid gap-3"><CustomDatePicker aria-label="Von" value={filters.from} onChange={(from) => updateFilters({ from })} className="h-10" /><CustomDatePicker aria-label="Bis" value={filters.to} onChange={(to) => updateFilters({ to })} className="h-10" /></div></ColumnFilterPopover>} />
                <DataHeaderCell>Aktion</DataHeaderCell>
              </tr>
            </DataTableHead>
            <tbody>
              {visibleTasks.map((task) => (
                <tr key={task.id} className="hover:bg-slate-50">
                  <td className="sticky left-0 z-[5] max-w-[360px] border-b border-slate-100 bg-white px-4 py-3 shadow-[2px_0_0_0_rgb(241_245_249)]">
                    <TaskReferenceLink task={task} onOpenTask={onOpenTask} className="max-w-full font-semibold text-slate-950">
                      {task.title}
                    </TaskReferenceLink>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <ReviewTaskAttentionBadges task={task} />
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-500">{task.priority} · {task.hours}h · {task.workstream || "ohne Bereich"}</div>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{taskAssigneeLabel(task)}</td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{profileName(task.reviewOwnerProfileId)}</td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">
                    <div>{reviewLabel(task.reviewStatus)} · {normalizeStatus(task.status)}</div>
                    {task.scoreFinal ? <div className="mt-1 text-xs text-emerald-700">{task.scorePoints} Punkte final</div> : null}
                    {isBlockedReviewTask(task, data) ? <div className="mt-1 text-xs font-semibold text-orange-700">Geblockt</div> : null}
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{dateRange(task)}</td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <UiLinkButton href={`/reviews/${encodeURIComponent(task.id)}`} variant="blue" size="sm">
                      Review öffnen
                    </UiLinkButton>
                  </td>
                </tr>
              ))}
              {!visibleTasks.length && (
                <DataEmptyRow colSpan={6}>
                  {metrics.total ? "Keine Reviews für diese Filter." : <span className="grid gap-3"><span>Noch keine Reviews.</span><UiLinkButton href="/sprint" variant="blue" size="sm">Reviews im Sprint vorbereiten</UiLinkButton></span>}
                </DataEmptyRow>
              )}
            </tbody>
    </DataTableFrame>
  );
}
