"use client";

import { Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { UiButton, UiTextInput } from "@/shared/atoms/ui-primitives";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";
import { initiativeOptionLabel } from "@/lib/display";
import { taskStatuses } from "@/lib/status";
import { reviewLabel } from "@/lib/platform";
import type { Profile, Sprint, Task } from "@/lib/types";
import { FilterField, FilterToolbar, FilterToggleGroup, type ActiveFilter } from "@/shared/molecules/filter-toolbar";
import { DEFAULT_PLANNING_FILTERS, type PlanningFilters as PlanningFiltersValue } from "@/features/planning/hooks/use-planning-view-state";
import { PlanningLevelSelect } from "@/features/planning/molecules/planning-level-select";
import type { PlanningLevel } from "@/features/planning/model/planning-level";
import { strategicPlanningStatuses } from "@/features/tasks/model/planning-item-capabilities";
import type { TableUrlHistoryMode } from "@/shared/hooks/use-table-url-state";

function useCompactPlanningViewport() {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 1199px)");
    const update = () => setCompact(mediaQuery.matches);
    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  return compact;
}

type PlanningFiltersProps = {
  filters: PlanningFiltersValue;
  planningLevel: PlanningLevel;
  planningParentFilterId: string;
  profiles: Profile[];
  initiatives: Task[];
  sprints: Sprint[];
  tasks: Task[];
  workstreams: string[];
  quickFilters: Array<{ id: string; label: string }>;
  expanded: boolean;
  visibleCount: number;
  totalCount: number;
  showPlanningLevel: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onChange: (filters: PlanningFiltersValue, history?: TableUrlHistoryMode) => void;
  onPlanningLevelChange: (level: PlanningLevel) => void;
  onPlanningParentFilterChange: (parentId: string) => void;
};

export function PlanningFilters({
  filters,
  planningLevel,
  planningParentFilterId,
  profiles,
  initiatives,
  sprints,
  tasks,
  workstreams,
  quickFilters,
  expanded,
  visibleCount,
  totalCount,
  showPlanningLevel,
  onExpandedChange,
  onChange,
  onPlanningLevelChange,
  onPlanningParentFilterChange,
}: PlanningFiltersProps) {
  const compactViewport = useCompactPlanningViewport();
  const mobileDialogRef = useModalDialog<HTMLDivElement>({
    open: expanded && compactViewport,
    onClose: () => onExpandedChange(false),
  });
  const profileName = profiles.find((profile) => profile.id === filters.assignee)?.name || filters.assignee;
  const initiativeName = initiatives.find((initiative) => initiative.id === filters.initiativeId)?.title || filters.initiativeId;
  const sprintName = sprints.find((sprint) => sprint.id === filters.sprintId)?.name || filters.sprintId;
  const isStrategicBoard = showPlanningLevel && planningLevel !== "deliverable";
  const parentTasks = planningLevel === "initiative"
    ? tasks.filter((task) => task.taskType === "epic")
    : planningLevel === "deliverable"
      ? tasks.filter((task) => task.taskType === "initiative")
      : [];
  const parentLabel = planningLevel === "initiative" ? "Epic" : "Initiative";
  const parentName = parentTasks.find((task) => task.id === planningParentFilterId)?.title || planningParentFilterId;
  const activeFilters: ActiveFilter[] = [
    ...(filters.assignee !== "Alle" ? [{ id: "assignee", label: `Zuständig: ${profileName}`, onRemove: () => onChange({ ...filters, assignee: "Alle" }) }] : []),
    ...(filters.status !== "Alle" ? [{ id: "status", label: `Status: ${filters.status}`, onRemove: () => onChange({ ...filters, status: "Alle" }) }] : []),
    ...(filters.priority !== "Alle" ? [{ id: "priority", label: `Priorität: ${filters.priority}`, onRemove: () => onChange({ ...filters, priority: "Alle" }) }] : []),
    ...(!isStrategicBoard && filters.review !== "Alle" ? [{ id: "review", label: `Review-Status: ${reviewLabel(filters.review as Parameters<typeof reviewLabel>[0])}`, onRemove: () => onChange({ ...filters, review: "Alle" }) }] : []),
    ...(!isStrategicBoard && filters.initiativeId !== "Alle" ? [{ id: "initiative", label: `Initiative: ${initiativeName}`, onRemove: () => onChange({ ...filters, initiativeId: "Alle" }) }] : []),
    ...(showPlanningLevel && planningLevel === "initiative" && planningParentFilterId !== "all" ? [{ id: "parent-epic", label: `Epic: ${parentName}`, onRemove: () => onPlanningParentFilterChange("all") }] : []),
    ...(!isStrategicBoard && filters.sprintId !== "Alle" ? [{ id: "sprint", label: `Sprint: ${sprintName}`, onRemove: () => onChange({ ...filters, sprintId: "Alle" }) }] : []),
    ...(!isStrategicBoard && filters.workstream !== "Alle" ? [{ id: "workstream", label: `Bereich: ${filters.workstream}`, onRemove: () => onChange({ ...filters, workstream: "Alle" }) }] : []),
    ...(!isStrategicBoard && filters.risk !== "Alle" ? [{ id: "risk", label: `Risiko: ${filters.risk === "critical" ? "Kritisch" : filters.risk === "blocked" ? "Blockiert" : filters.risk === "evidence" ? "Evidence fehlt" : "GitHub fehlt"}`, onRemove: () => onChange({ ...filters, risk: "Alle" }) }] : []),
    ...(filters.targetFrom ? [{ id: "targetFrom", label: `Ziel ab: ${filters.targetFrom}`, onRemove: () => onChange({ ...filters, targetFrom: "" }) }] : []),
    ...(filters.targetTo ? [{ id: "targetTo", label: `Ziel bis: ${filters.targetTo}`, onRemove: () => onChange({ ...filters, targetTo: "" }) }] : []),
    ...(!isStrategicBoard ? filters.quick.map((quick) => ({
      id: `quick-${quick}`,
      label: quick === "mine" ? "Meine Aufgaben" : quickFilters.find((item) => item.id === quick)?.label || quick,
      onRemove: () => onChange({ ...filters, quick: filters.quick.filter((item) => item !== quick) }),
    })) : []),
  ];
  const isDirty = JSON.stringify(filters) !== JSON.stringify(DEFAULT_PLANNING_FILTERS)
    || planningParentFilterId !== "all";
  const parentContext = showPlanningLevel && parentTasks.length > 0 ? (
    <div data-tour-id="planning-kanban-parent-filter" className="flex min-w-0 items-center gap-2">
      <span className="shrink-0 text-xs font-semibold text-slate-600">{parentLabel}</span>
      <CustomSelect
        aria-label={planningLevel === "initiative" ? "Nach Parent-Epic filtern" : "Nach Parent-Initiative filtern"}
        value={planningParentFilterId}
        onChange={onPlanningParentFilterChange}
        options={[
          { value: "all", label: planningLevel === "initiative" ? "Alle Epics" : "Alle Initiativen" },
          ...parentTasks.map((task) => ({ value: task.id, label: task.title })),
        ]}
        className="h-10 min-w-44 flex-1 text-sm"
      />
    </div>
  ) : null;

  const resetFilters = () => {
    onChange(DEFAULT_PLANNING_FILTERS);
    onPlanningParentFilterChange("all");
  };

  const advancedFilterControls = (
    <>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <FilterField label="Zuständig">
          <CustomSelect
            aria-label="Nach Zuständigkeit filtern"
            value={filters.assignee}
            onChange={(assignee) => onChange({ ...filters, assignee })}
            className="h-10 text-sm"
            options={[{ value: "Alle", label: "Alle Zuständigen" }, ...profiles.map((profile) => ({ value: profile.id, label: profile.name }))]}
          />
        </FilterField>
        <FilterField label="Status">
          <CustomSelect
            aria-label="Nach Status filtern"
            value={filters.status}
            onChange={(status) => onChange({ ...filters, status })}
            className="h-10 text-sm"
            options={[{ value: "Alle", label: "Alle Status" }, ...(isStrategicBoard ? strategicPlanningStatuses : taskStatuses).map((status) => ({ value: status, label: status }))]}
          />
        </FilterField>
        <FilterField label="Priorität">
          <CustomSelect
            aria-label="Nach Priorität filtern"
            value={filters.priority}
            onChange={(priority) => onChange({ ...filters, priority })}
            className="h-10 text-sm"
            options={[{ value: "Alle", label: "Alle Prioritäten" }, ...["P0", "P1", "P2", "P3", "P4"].map((priority) => ({ value: priority, label: priority }))]}
          />
        </FilterField>
        {!isStrategicBoard ? (
          <FilterField label="Review-Status">
            <CustomSelect
              aria-label="Nach Review-Status filtern"
              value={filters.review}
              onChange={(review) => onChange({ ...filters, review })}
              className="h-10 text-sm"
              options={[
                { value: "Alle", label: "Alle Review-Status" },
                { value: "requested", label: "Angefragt" },
                { value: "accepted", label: "Akzeptiert" },
                { value: "partial", label: "Kleine Nacharbeit" },
                { value: "changes_requested", label: "Grundlegend überarbeiten" },
                { value: "not_requested", label: "Nicht angefragt" },
              ]}
            />
          </FilterField>
        ) : null}
        {!showPlanningLevel ? (
          <FilterField label="Initiative">
            <CustomSelect
              aria-label="Nach Initiative filtern"
              value={filters.initiativeId}
              onChange={(initiativeId) => onChange({ ...filters, initiativeId })}
              className="h-10 text-sm"
              options={[{ value: "Alle", label: "Alle Initiativen" }, ...initiatives.map((initiative) => ({ value: initiative.id, label: initiativeOptionLabel(initiative) }))]}
            />
          </FilterField>
        ) : null}
        {!isStrategicBoard ? (
          <FilterField label="Sprint">
            <CustomSelect
              aria-label="Nach Sprint filtern"
              value={filters.sprintId}
              onChange={(sprintId) => onChange({ ...filters, sprintId })}
              className="h-10 text-sm"
              options={[{ value: "Alle", label: "Alle Sprints" }, ...sprints.map((sprint) => ({ value: sprint.id, label: sprint.name }))]}
            />
          </FilterField>
        ) : null}
        {!isStrategicBoard ? (
          <FilterField label="Bereich">
            <CustomSelect
              aria-label="Nach Bereich filtern"
              value={filters.workstream}
              onChange={(workstream) => onChange({ ...filters, workstream })}
              className="h-10 text-sm"
              options={[{ value: "Alle", label: "Alle Bereiche" }, ...workstreams.map((workstream) => ({ value: workstream, label: workstream }))]}
            />
          </FilterField>
        ) : null}
        {!isStrategicBoard ? (
          <FilterField label="Risiko">
            <CustomSelect
              aria-label="Nach Risiko filtern"
              value={filters.risk}
              onChange={(risk) => onChange({ ...filters, risk })}
              className="h-10 text-sm"
              options={[
                { value: "Alle", label: "Alle Risiken" },
                { value: "critical", label: "Kritisch" },
                { value: "blocked", label: "Blockiert" },
                { value: "evidence", label: "Evidence fehlt" },
                { value: "github", label: "GitHub fehlt" },
              ]}
            />
          </FilterField>
        ) : null}
        <FilterField label="Zieltermin von">
          <CustomDatePicker
            aria-label="Nach Zieltermin ab filtern"
            value={filters.targetFrom}
            onChange={(targetFrom) => onChange({ ...filters, targetFrom })}
            className="h-10"
          />
        </FilterField>
        <FilterField label="Zieltermin bis">
          <CustomDatePicker
            aria-label="Nach Zieltermin bis filtern"
            value={filters.targetTo}
            onChange={(targetTo) => onChange({ ...filters, targetTo })}
            className="h-10"
          />
        </FilterField>
      </div>
      {!isStrategicBoard ? (
        <div className="mt-4 grid gap-2">
          <div className="text-xs font-semibold text-slate-600">Schnellfilter kombinieren</div>
          <FilterToggleGroup
            label="Schnellfilter"
            values={filters.quick.filter((quick) => quick !== "mine")}
            options={quickFilters.map((filter) => ({ value: filter.id, label: filter.label }))}
            onChange={(quick) => onChange({ ...filters, quick: filters.quick.includes("mine") ? ["mine", ...quick] : quick })}
          />
        </div>
      ) : null}
    </>
  );

  return (
    <>
      <div className="hidden min-[1200px]:block">
        <FilterToolbar
          className="mx-6 mb-4"
          panelId="planning-filters"
          searchLabel="Aufgaben durchsuchen"
          searchPlaceholder={isStrategicBoard ? "Titel, Ziel, Priorität oder Zuständigkeit suchen" : "Aufgabe, Bereich, Priorität oder GitHub-Referenz suchen"}
          query={filters.query}
          onQueryChange={(query) => onChange({ ...filters, query }, "replace")}
          expanded={expanded}
          onExpandedChange={onExpandedChange}
          activeFilters={activeFilters}
          isDirty={isDirty}
          onReset={resetFilters}
          results={[{ id: "tasks", visibleCount, totalCount }]}
          leadingControls={showPlanningLevel ? (
            <div data-tour-id="planning-kanban-level-switch">
              <PlanningLevelSelect
                ariaLabel="Planungsebene im Kanban"
                value={planningLevel}
                tasks={tasks}
                onChange={onPlanningLevelChange}
              />
            </div>
          ) : null}
          contextControls={parentContext}
        >
          {advancedFilterControls}
        </FilterToolbar>
      </div>

      {expanded && compactViewport ? (
        <div
          ref={mobileDialogRef}
          id="planning-mobile-filter-sheet"
          className="fixed inset-0 z-[100] grid items-end min-[1200px]:hidden"
          role="dialog"
          aria-modal="true"
          aria-labelledby="planning-mobile-filter-title"
          tabIndex={-1}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            onClick={() => onExpandedChange(false)}
            className="absolute inset-0 bg-slate-950/35 backdrop-blur-[1px]"
          />
          <div className="relative z-10 flex max-h-[min(88dvh,48rem)] min-h-0 w-full flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div className="min-w-0">
                <h2 id="planning-mobile-filter-title" className="text-base font-semibold text-slate-950">Planung filtern</h2>
                <p className="text-xs text-slate-500" aria-live="polite">{visibleCount} von {totalCount} Ergebnissen</p>
              </div>
              <button
                type="button"
                data-autofocus
                onClick={() => onExpandedChange(false)}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                aria-label="Filter schließen"
              >
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
              <div className="grid gap-4">
                <label className="relative min-w-0">
                  <span className="sr-only">Aufgaben durchsuchen</span>
                  <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} aria-hidden="true" />
                  <UiTextInput
                    type="search"
                    value={filters.query}
                    onChange={(event) => onChange({ ...filters, query: event.target.value }, "replace")}
                    inputSize="lg"
                    inputPadding="md"
                    className="w-full pl-9 pr-9"
                    placeholder={isStrategicBoard ? "Titel, Ziel oder Zuständigkeit" : "Aufgabe, Bereich oder GitHub-Referenz"}
                    aria-label="Aufgaben durchsuchen"
                  />
                  {filters.query ? (
                    <button
                      type="button"
                      onClick={() => onChange({ ...filters, query: "" }, "replace")}
                      className="absolute right-1 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                      aria-label="Suche löschen"
                    >
                      <X size={16} aria-hidden="true" />
                    </button>
                  ) : null}
                </label>

                {showPlanningLevel ? (
                  <FilterField label="Planungsebene">
                    <PlanningLevelSelect
                      ariaLabel="Planungsebene im Kanban"
                      value={planningLevel}
                      tasks={tasks}
                      onChange={onPlanningLevelChange}
                    />
                  </FilterField>
                ) : null}
                {parentContext}

                {activeFilters.length > 0 ? (
                  <div className="flex flex-wrap gap-2" aria-label="Aktive Filter">
                    {activeFilters.map((filter) => (
                      <button
                        key={filter.id}
                        type="button"
                        onClick={filter.onRemove}
                        className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        aria-label={`${filter.label} entfernen`}
                      >
                        <span className="truncate">{filter.label}</span>
                        <X size={13} aria-hidden="true" />
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="border-t border-slate-100 pt-4">
                  {advancedFilterControls}
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-3 border-t border-slate-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
              {isDirty ? (
                <UiButton variant="ghost" size="lg" onClick={resetFilters} className="min-w-0 flex-1 text-slate-600">
                  Zurücksetzen
                </UiButton>
              ) : null}
              <UiButton variant="primary" size="lg" onClick={() => onExpandedChange(false)} className="min-w-0 flex-1">
                {visibleCount} anzeigen
              </UiButton>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
