"use client";

import { useState } from "react";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { UiLinkButton, UiPanel } from "@/shared/atoms/ui-primitives";
import { ReviewTaskAttentionBadges } from "@/features/tasks/molecules/task-attention-badges";
import { TaskReferenceLink } from "@/features/tasks/atoms/task-reference-link";
import { dateRange, taskAssigneeLabel } from "@/lib/display";
import { reviewLabel } from "@/lib/platform";
import { buildReviewWorkspaceViewModel, isBlockedReviewTask, reviewStatusFilterOptions, type ReviewOwnerFilter, type ReviewSort, type ReviewStatusFilter } from "@/features/reviews/model/review-workspace-view-model";
import { normalizeStatus } from "@/lib/status";
import type { PlanningData, Profile } from "@/lib/types";
import { FilterField, FilterSegmentedControl, FilterToolbar, type ActiveFilter } from "@/shared/molecules/filter-toolbar";
import { SortableDataHeaderCell, type SortDirection } from "@/shared/molecules/data-surface";

type Props = {
  data: PlanningData;
  currentProfile: Profile | null;
  statusFilter: ReviewStatusFilter;
  ownerFilter: ReviewOwnerFilter;
  onStatusFilterChange: (value: ReviewStatusFilter) => void;
  onOwnerFilterChange: (value: ReviewOwnerFilter) => void;
  onOpenTask: (taskId: string) => void;
};

export function ReviewWorkspaceOverview({
  data,
  currentProfile,
  statusFilter,
  ownerFilter,
  onStatusFilterChange,
  onOwnerFilterChange,
  onOpenTask,
}: Props) {
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sort, setSort] = useState<ReviewSort>("priority");
  const [direction, setDirection] = useState<Exclude<SortDirection, null>>("asc");
  const { visibleTasks, ownerOptions, metrics } = buildReviewWorkspaceViewModel({
    data,
    currentProfile,
    filters: { status: statusFilter, owner: ownerFilter, query, sort, direction },
  });
  const profileName = (profileId = "") => data.profiles.find((profile) => profile.id === profileId)?.name || profileId || "Ohne Review Owner";
  const statusCounts: Record<ReviewStatusFilter, number> = {
    open: metrics.open,
    completed: metrics.completed,
    rework: metrics.rework,
    blocked: metrics.blocked,
    all: metrics.total,
  };
  const activeFilters: ActiveFilter[] = ownerFilter !== "all" ? [{
    id: "owner",
    label: `Review Owner: ${ownerOptions.find((option) => option.value === ownerFilter)?.label || ownerFilter}`,
    onRemove: () => onOwnerFilterChange("all"),
  }] : [];
  const toggleSort = (nextSort: ReviewSort) => {
    if (sort === nextSort) setDirection((current) => current === "asc" ? "desc" : "asc");
    else {
      setSort(nextSort);
      setDirection("asc");
    }
  };
  const directionFor = (key: ReviewSort): SortDirection => sort === key ? direction : null;

  if (metrics.total === 0) {
    return (
      <UiPanel>
        <div className="grid gap-3 py-6 text-center">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Noch keine Reviews</h2>
            <p className="mt-1 text-sm text-slate-600">Sobald Sprint-Aufgaben zur Accountable-Review gehen, erscheint hier die Review-Zentrale.</p>
          </div>
          <div>
            <UiLinkButton href="/sprint" variant="blue" size="md">
              Reviews im Sprint vorbereiten
            </UiLinkButton>
          </div>
        </div>
      </UiPanel>
    );
  }

  return (
    <div className="grid gap-4">
      <FilterToolbar
        searchLabel="Reviews durchsuchen"
        searchPlaceholder="Aufgabe, Zuständigkeit oder Review Owner suchen"
        query={query}
        onQueryChange={setQuery}
        expanded={filtersOpen}
        onExpandedChange={setFiltersOpen}
        activeFilters={activeFilters}
        isDirty={statusFilter !== "open" || ownerFilter !== "all" || Boolean(query) || sort !== "priority" || direction !== "asc"}
        onReset={() => { setQuery(""); onOwnerFilterChange("all"); onStatusFilterChange("open"); setSort("priority"); setDirection("asc"); }}
        visibleCount={visibleTasks.length}
        totalCount={metrics.total}
        panelId="review-data-filters"
        primaryControls={(
          <FilterSegmentedControl
            label="Review-Status"
            value={statusFilter}
            options={reviewStatusFilterOptions.map((option) => ({ ...option, count: statusCounts[option.value] }))}
            onChange={onStatusFilterChange}
          />
        )}
      >
        <FilterField label="Review Owner" className="max-w-xs">
          <CustomSelect
            aria-label="Nach Review Owner filtern"
            value={ownerFilter}
            onChange={onOwnerFilterChange}
            className="h-10 text-sm"
            options={ownerOptions}
          />
        </FilterField>
      </FilterToolbar>

      <UiPanel padding="none" className="overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-950">Reviews</h2>
          <p className="text-xs text-slate-500">{visibleTasks.length} Treffer.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[860px] w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <SortableDataHeaderCell className="px-4" label="Aufgabe" direction={directionFor("title")} onSort={() => toggleSort("title")} />
                <SortableDataHeaderCell label="Zuständig" direction={directionFor("assignee")} onSort={() => toggleSort("assignee")} />
                <SortableDataHeaderCell label="Review Owner" direction={directionFor("owner")} onSort={() => toggleSort("owner")} />
                <SortableDataHeaderCell label="Status" direction={directionFor("status")} onSort={() => toggleSort("status")} />
                <SortableDataHeaderCell label="Zeitraum" direction={directionFor("date")} onSort={() => toggleSort("date")} />
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {visibleTasks.map((task) => (
                <tr key={task.id} className="hover:bg-slate-50">
                  <td className="max-w-[360px] border-b border-slate-100 px-4 py-3">
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
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
                    Keine Reviews für diesen Filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </UiPanel>
    </div>
  );
}
