import { CustomSelect } from "@/shared/atoms/custom-select";
import { initiativeOptionLabel } from "@/lib/display";
import { taskStatuses } from "@/lib/status";
import type { Package, Profile } from "@/lib/types";
import { FilterField, FilterToolbar, FilterToggleGroup, type ActiveFilter } from "@/shared/molecules/filter-toolbar";

export type PlanningFiltersValue = {
  query: string;
  assignee: string;
  status: string;
  priority: string;
  packageId: string;
  quick: string[];
};

type PlanningFiltersProps = {
  filters: PlanningFiltersValue;
  profiles: Profile[];
  packages: Package[];
  quickFilters: Array<{ id: string; label: string }>;
  expanded: boolean;
  visibleCount: number;
  totalCount: number;
  onExpandedChange: (expanded: boolean) => void;
  onChange: (filters: PlanningFiltersValue) => void;
};

const defaultPlanningFilters: PlanningFiltersValue = {
  query: "",
  assignee: "Alle",
  status: "Alle",
  priority: "Alle",
  packageId: "Alle",
  quick: [],
};

export function PlanningFilters({
  filters,
  profiles,
  packages,
  quickFilters,
  expanded,
  visibleCount,
  totalCount,
  onExpandedChange,
  onChange,
}: PlanningFiltersProps) {
  const profileName = profiles.find((profile) => profile.id === filters.assignee)?.name || filters.assignee;
  const initiativeName = packages.find((pack) => pack.id === filters.packageId)?.title || filters.packageId;
  const activeFilters: ActiveFilter[] = [
    ...(filters.assignee !== "Alle" ? [{ id: "assignee", label: `Zuständig: ${profileName}`, onRemove: () => onChange({ ...filters, assignee: "Alle" }) }] : []),
    ...(filters.status !== "Alle" ? [{ id: "status", label: `Status: ${filters.status}`, onRemove: () => onChange({ ...filters, status: "Alle" }) }] : []),
    ...(filters.priority !== "Alle" ? [{ id: "priority", label: `Priorität: ${filters.priority}`, onRemove: () => onChange({ ...filters, priority: "Alle" }) }] : []),
    ...(filters.packageId !== "Alle" ? [{ id: "initiative", label: `Initiative: ${initiativeName}`, onRemove: () => onChange({ ...filters, packageId: "Alle" }) }] : []),
    ...filters.quick.map((quick) => ({
      id: `quick-${quick}`,
      label: quick === "mine" ? "Meine Aufgaben" : quickFilters.find((item) => item.id === quick)?.label || quick,
      onRemove: () => onChange({ ...filters, quick: filters.quick.filter((item) => item !== quick) }),
    })),
  ];

  return (
    <FilterToolbar
      className="mx-4 mb-4 lg:mx-6"
      panelId="planning-data-filters"
      searchLabel="Aufgaben durchsuchen"
      searchPlaceholder="Aufgabe, Bereich, Priorität oder GitHub-Referenz suchen"
      query={filters.query}
      onQueryChange={(query) => onChange({ ...filters, query })}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      activeFilters={activeFilters}
      onReset={() => onChange(defaultPlanningFilters)}
      visibleCount={visibleCount}
      totalCount={totalCount}
    >
      <div className="grid gap-4 xl:grid-cols-4">
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
            options={[{ value: "Alle", label: "Alle Status" }, ...taskStatuses.map((status) => ({ value: status, label: status }))]}
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
        <FilterField label="Initiative">
          <CustomSelect
            aria-label="Nach Initiative filtern"
            value={filters.packageId}
            onChange={(packageId) => onChange({ ...filters, packageId })}
            className="h-10 text-sm"
            options={[{ value: "Alle", label: "Alle Initiativen" }, ...packages.map((pack) => ({ value: pack.id, label: initiativeOptionLabel(pack) }))]}
          />
        </FilterField>
      </div>
      <div className="mt-4 grid gap-2">
        <div className="text-xs font-semibold text-slate-600">Schnellfilter kombinieren</div>
        <FilterToggleGroup
          label="Schnellfilter"
          values={filters.quick.filter((quick) => quick !== "mine")}
          options={quickFilters.map((filter) => ({ value: filter.id, label: filter.label }))}
          onChange={(quick) => onChange({ ...filters, quick: filters.quick.includes("mine") ? ["mine", ...quick] : quick })}
        />
      </div>
    </FilterToolbar>
  );
}
