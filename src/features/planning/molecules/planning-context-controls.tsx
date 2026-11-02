import { Plus, SlidersHorizontal, UserRound } from "lucide-react";
import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { DEFAULT_PLANNING_FILTERS } from "@/features/planning/hooks/use-planning-view-state";
import { viewTabs } from "@/features/planning/model/planning-app-model";
import { planningLevels, type PlanningLevel } from "@/features/planning/model/planning-level";
import type { ViewMode } from "@/lib/types";
import { CustomSelect } from "@/shared/atoms/custom-select";

type PlanningContextControlsProps = Pick<PlanningAppController,
  "filters" | "filtersAvailable" | "headerActions" | "workspace" | "planningParentFilterId"
  | "setFilters" | "view" | "setView" | "planningLevel" | "setPlanningLevel" | "data"
  | "setShowFilters" | "showFilters"
>;

export function PlanningContextControls({ filters, filtersAvailable, headerActions, workspace, planningParentFilterId, setFilters, view, setView, planningLevel, setPlanningLevel, data, setShowFilters, showFilters }: PlanningContextControlsProps) {
  const planningFiltersDirty = JSON.stringify(filters) !== JSON.stringify(DEFAULT_PLANNING_FILTERS) || planningParentFilterId !== "all";
  const mineActive = filters.quick.includes("mine");
  const actionButtons = headerActions.map((action) => (
    <button
      key={action.id}
      type="button"
      onClick={() => {
        if (!action.disabled) action.onClick();
      }}
      aria-disabled={action.disabled || undefined}
      title={action.disabledReason}
      aria-label={action.disabledReason ? `${action.label}. ${action.disabledReason}` : action.label}
      className={`inline-flex h-9 min-w-0 items-center justify-center gap-2 whitespace-nowrap rounded-md px-3 text-sm font-semibold transition ${
        action.disabled
          ? "cursor-not-allowed border border-slate-200 bg-slate-100 text-slate-400"
          : action.variant === "primary"
          ? "border border-blue-600 bg-blue-600 text-white hover:bg-blue-700"
          : "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      <Plus size={16} aria-hidden="true" />
      <span className="truncate">{action.label}</span>
    </button>
  ));
  return <>
      {filtersAvailable && (
        <div className="hidden gap-2 min-[1200px]:grid">
          <div className="grid gap-3 md:flex md:flex-wrap md:items-center md:justify-between">
            <div className="grid min-w-0 flex-1 gap-2">
              <div className="grid max-w-full grid-cols-[74px_minmax(0,1fr)] items-center gap-2" data-tour-id="planning-task-scope">
                <div className="text-xs font-semibold uppercase text-slate-500">Aufgaben</div>
                <div className="flex min-w-0 flex-nowrap gap-2 overflow-x-auto pb-1 [contain:inline-size] sm:flex-wrap sm:overflow-visible sm:pb-0 sm:[contain:none]">
                  {[
                    { id: "", label: "Alle" },
                    { id: "mine", label: "Meine" },
                  ].map((scope) => {
                    const active = scope.id ? filters.quick.includes(scope.id) : !filters.quick.includes("mine");
                    return (
                      <button
                        key={scope.label}
                        type="button"
                        onClick={() => setFilters({
                          ...filters,
                          assignee: "Alle",
                          quick: scope.id
                            ? Array.from(new Set([scope.id, ...filters.quick.filter((item) => item !== "mine")]))
                            : filters.quick.filter((item) => item !== "mine"),
                        })}
                        className={`inline-flex h-8 shrink-0 items-center border-b-2 px-1 text-sm font-semibold ${
                          active ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"
                        }`}
                        aria-pressed={active}
                      >
                        {scope.label}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid max-w-full grid-cols-[74px_minmax(0,1fr)] items-center gap-2">
                <div className="text-xs font-semibold uppercase text-slate-500">Ansicht</div>
                <div className="flex min-w-0 flex-nowrap gap-2 overflow-x-auto pb-1 [contain:inline-size] sm:flex-wrap sm:overflow-visible sm:pb-0 sm:[contain:none]">
                  {viewTabs.map((tab) => {
                    const Icon = tab.icon;
                    const active = view === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        onClick={() => setView(tab.id)}
                        className={`inline-flex h-8 shrink-0 items-center gap-2 border-b-2 px-1 text-sm font-semibold ${
                          active ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"
                        }`}
                      >
                        <Icon size={16} />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className={`grid items-center gap-2 sm:flex sm:flex-wrap md:shrink-0 md:justify-end ${headerActions.length > 1 ? "grid-cols-2" : "grid-cols-[max-content]"}`}>
              {actionButtons}
            </div>
          </div>
        </div>
      )}
      {!filtersAvailable && headerActions.length > 0 && workspace !== "notifications" && (
        <div className="flex justify-end">
          <div className={`grid w-full gap-2 sm:flex sm:w-auto sm:flex-wrap ${headerActions.length > 1 ? "grid-cols-2" : "grid-cols-[max-content]"}`}>{actionButtons}</div>
        </div>
      )}
      {filtersAvailable ? (
        <div
          data-mobile-planning-toolbar
          className="min-w-0 min-[1200px]:hidden"
        >
          <div className="flex min-h-11 min-w-0 items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              data-tour-id="planning-task-scope"
              aria-pressed={mineActive}
              onClick={() => setFilters({
                ...filters,
                assignee: "Alle",
                quick: mineActive
                  ? filters.quick.filter((item) => item !== "mine")
                  : Array.from(new Set(["mine", ...filters.quick])),
              })}
              className={`inline-flex h-11 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                mineActive ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <UserRound size={16} aria-hidden="true" />
              {mineActive ? "Meine" : "Alle"}
            </button>
            <CustomSelect
              aria-label="Planungsansicht wechseln"
              value={view}
              onChange={(nextView) => setView(nextView as ViewMode)}
              options={viewTabs.map((tab) => ({ value: tab.id, label: tab.label }))}
              className="h-11 w-24 shrink-0 text-sm"
              menuClassName="min-w-36"
            />
            <button
              type="button"
              data-tour-id="planning-mobile-filter-trigger"
              onClick={() => setShowFilters(true)}
              aria-expanded={showFilters}
              aria-controls="planning-mobile-filter-sheet"
              className={`relative inline-flex h-11 shrink-0 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                planningFiltersDirty ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              }`}
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
              Filter
              {planningFiltersDirty ? <span className="h-2 w-2 rounded-full bg-blue-600" aria-label="Filter aktiv" /> : null}
            </button>
            {view === "board" ? (
              <div data-tour-id="planning-kanban-level-switch" className="w-36 shrink-0">
                <CustomSelect
                  aria-label="Planungsebene im Kanban wechseln"
                  value={planningLevel}
                  onChange={(level) => setPlanningLevel(level as PlanningLevel)}
                  options={planningLevels.map((level) => ({
                    value: level.value,
                    label: `${level.label} · ${data.tasks.filter((task) => task.taskType === level.value).length}`,
                  }))}
                  className="h-11 text-sm"
                  menuClassName="min-w-44"
                />
              </div>
            ) : null}
            {actionButtons.length > 0 ? <div className="flex shrink-0 items-center gap-2">{actionButtons}</div> : null}
          </div>
        </div>
      ) : null}
  </>;
}
