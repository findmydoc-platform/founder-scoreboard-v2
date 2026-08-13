import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { CustomSelect } from "@/shared/atoms/custom-select";
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

  return (
    <FilterToolbar
      compactMobile
      className="mx-4 mb-4 lg:mx-6"
      panelId="planning-filters"
      searchLabel="Aufgaben durchsuchen"
      searchPlaceholder={isStrategicBoard ? "Titel, Ziel, Priorität oder Zuständigkeit suchen" : "Aufgabe, Bereich, Priorität oder GitHub-Referenz suchen"}
      query={filters.query}
      onQueryChange={(query) => onChange({ ...filters, query }, "replace")}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      activeFilters={activeFilters}
      isDirty={JSON.stringify(filters) !== JSON.stringify(DEFAULT_PLANNING_FILTERS) || planningParentFilterId !== "all"}
      onReset={() => {
        onChange(DEFAULT_PLANNING_FILTERS);
        onPlanningParentFilterChange("all");
      }}
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
        {!isStrategicBoard ? <FilterField label="Review-Status">
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
        </FilterField> : null}
        {!showPlanningLevel ? <FilterField label="Initiative">
          <CustomSelect
            aria-label="Nach Initiative filtern"
            value={filters.initiativeId}
            onChange={(initiativeId) => onChange({ ...filters, initiativeId })}
            className="h-10 text-sm"
            options={[{ value: "Alle", label: "Alle Initiativen" }, ...initiatives.map((initiative) => ({ value: initiative.id, label: initiativeOptionLabel(initiative) }))]}
          />
        </FilterField> : null}
        {!isStrategicBoard ? <FilterField label="Sprint">
          <CustomSelect aria-label="Nach Sprint filtern" value={filters.sprintId} onChange={(sprintId) => onChange({ ...filters, sprintId })} className="h-10 text-sm" options={[{ value: "Alle", label: "Alle Sprints" }, ...sprints.map((sprint) => ({ value: sprint.id, label: sprint.name }))]} />
        </FilterField> : null}
        {!isStrategicBoard ? <FilterField label="Bereich">
          <CustomSelect aria-label="Nach Bereich filtern" value={filters.workstream} onChange={(workstream) => onChange({ ...filters, workstream })} className="h-10 text-sm" options={[{ value: "Alle", label: "Alle Bereiche" }, ...workstreams.map((workstream) => ({ value: workstream, label: workstream }))]} />
        </FilterField> : null}
        {!isStrategicBoard ? <FilterField label="Risiko">
          <CustomSelect aria-label="Nach Risiko filtern" value={filters.risk} onChange={(risk) => onChange({ ...filters, risk })} className="h-10 text-sm" options={[{ value: "Alle", label: "Alle Risiken" }, { value: "critical", label: "Kritisch" }, { value: "blocked", label: "Blockiert" }, { value: "evidence", label: "Evidence fehlt" }, { value: "github", label: "GitHub fehlt" }]} />
        </FilterField> : null}
        <FilterField label="Zieltermin von"><CustomDatePicker aria-label="Nach Zieltermin ab filtern" value={filters.targetFrom} onChange={(targetFrom) => onChange({ ...filters, targetFrom })} className="h-10" /></FilterField>
        <FilterField label="Zieltermin bis"><CustomDatePicker aria-label="Nach Zieltermin bis filtern" value={filters.targetTo} onChange={(targetTo) => onChange({ ...filters, targetTo })} className="h-10" /></FilterField>
      </div>
      {!isStrategicBoard ? <div className="mt-4 grid gap-2">
        <div className="text-xs font-semibold text-slate-600">Schnellfilter kombinieren</div>
        <FilterToggleGroup
          label="Schnellfilter"
          values={filters.quick.filter((quick) => quick !== "mine")}
          options={quickFilters.map((filter) => ({ value: filter.id, label: filter.label }))}
          onChange={(quick) => onChange({ ...filters, quick: filters.quick.includes("mine") ? ["mine", ...quick] : quick })}
        />
      </div> : null}
    </FilterToolbar>
  );
}
