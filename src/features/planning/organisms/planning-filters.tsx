import { Search } from "lucide-react";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { initiativeOptionLabel } from "@/lib/display";
import { taskStatuses } from "@/lib/status";
import type { Package, Profile } from "@/lib/types";
import { UiButton, UiPanel } from "@/shared/atoms/ui-primitives";

export type PlanningFiltersValue = {
  query: string;
  owner: string;
  status: string;
  priority: string;
  packageId: string;
  quick: string;
};

type PlanningFiltersProps = {
  filters: PlanningFiltersValue;
  profiles: Profile[];
  packages: Package[];
  quickFilters: Array<{ id: string; label: string }>;
  onChange: (filters: PlanningFiltersValue) => void;
};

export function PlanningFilters({ filters, profiles, packages, quickFilters, onChange }: PlanningFiltersProps) {
  return (
    <UiPanel className="mx-4 mb-4 lg:mx-6">
      <div className="grid gap-3 xl:grid-cols-[minmax(260px,1fr)_repeat(4,180px)]">
        <label className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            value={filters.query}
            onChange={(event) => onChange({ ...filters, query: event.target.value })}
            className="h-10 w-full rounded-md border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-blue-400"
            placeholder="Nach Aufgabe, Ziel, Bereich oder externer Ablage suchen"
          />
        </label>
        <CustomSelect value={filters.owner} onChange={(value) => onChange({ ...filters, owner: value })} className="h-10 text-sm" options={[{ value: "Alle", label: "Alle" }, ...profiles.map((profile) => ({ value: profile.name, label: profile.name }))]} />
        <CustomSelect value={filters.status} onChange={(value) => onChange({ ...filters, status: value })} className="h-10 text-sm" options={[{ value: "Alle", label: "Alle" }, ...taskStatuses.map((status) => ({ value: status, label: status }))]} />
        <CustomSelect value={filters.priority} onChange={(value) => onChange({ ...filters, priority: value })} className="h-10 text-sm" options={[{ value: "Alle", label: "Alle" }, ...["P0", "P1", "P2", "P3", "P4"].map((priority) => ({ value: priority, label: priority }))]} />
        <CustomSelect value={filters.packageId} onChange={(value) => onChange({ ...filters, packageId: value })} className="h-10 text-sm" options={[{ value: "Alle", label: "Alle Initiativen" }, ...packages.map((pack) => ({ value: pack.id, label: initiativeOptionLabel(pack) }))]} />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {quickFilters.map((filter) => (
          <UiButton
            key={filter.id}
            onClick={() => onChange({ ...filters, quick: filters.quick === filter.id ? "" : filter.id })}
            variant={filters.quick === filter.id ? "blue" : "secondary"}
            size="sm"
            className={filters.quick === filter.id ? "border-blue-300" : "text-slate-600"}
          >
            {filter.label}
          </UiButton>
        ))}
      </div>
    </UiPanel>
  );
}
