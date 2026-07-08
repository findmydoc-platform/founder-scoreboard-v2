import { CustomSelect } from "@/shared/atoms/custom-select";
import { hasOpenWaitingRelation } from "@/lib/platform";
import type { HygieneAlert, HygieneAlertAreaFilter, HygieneAlertSeverityFilter } from "@/features/execution/model/execution-layer-view-model";
import type { Task, TaskFocusItem, TaskRelation } from "@/lib/types";
import { UiBadge, UiButton, UiEmptyState, UiPanel } from "@/shared/atoms/ui-primitives";

export function ExecutionHygieneAlerts({
  alertSeverityFilter,
  alertAreaFilter,
  filteredAlerts,
  hygieneAlerts,
  visibleAlerts,
  taskById,
  allTasks,
  taskRelations,
  focusItems,
  pending,
  onSeverityFilterChange,
  onAreaFilterChange,
  onOpenTask,
  onSetFocus,
}: {
  alertSeverityFilter: HygieneAlertSeverityFilter;
  alertAreaFilter: HygieneAlertAreaFilter;
  filteredAlerts: HygieneAlert[];
  hygieneAlerts: HygieneAlert[];
  visibleAlerts: HygieneAlert[];
  taskById: Map<string, Task>;
  allTasks: Task[];
  taskRelations: TaskRelation[];
  focusItems: TaskFocusItem[];
  pending: boolean;
  onSeverityFilterChange: (value: HygieneAlertSeverityFilter) => void;
  onAreaFilterChange: (value: HygieneAlertAreaFilter) => void;
  onOpenTask: (task: Task) => void;
  onSetFocus: (task: Task, nextStep: string, status?: TaskFocusItem["status"]) => void;
}) {
  return (
    <UiPanel className="min-w-0">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-950">Hygiene Alerts</h2>
        <UiBadge tone="white" size="md">{filteredAlerts.length}/{hygieneAlerts.length} offen</UiBadge>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <CustomSelect
          value={alertSeverityFilter}
          onChange={(value) => onSeverityFilterChange(value as HygieneAlertSeverityFilter)}
          className="h-9 text-sm"
          options={[
            { value: "all", label: "Alle Schweregrade" },
            { value: "critical", label: "Kritisch" },
            { value: "warning", label: "Warnung" },
            { value: "info", label: "Info" },
          ]}
        />
        <CustomSelect
          value={alertAreaFilter}
          onChange={(value) => onAreaFilterChange(value as HygieneAlertAreaFilter)}
          className="h-9 text-sm"
          options={[
            { value: "all", label: "Alle Bereiche" },
            { value: "focus", label: "Fokus" },
            { value: "quality", label: "Qualität" },
            { value: "blocker", label: "Blocker" },
            { value: "review", label: "Review" },
            { value: "evidence", label: "Evidence" },
            { value: "dependency", label: "Abhängigkeit" },
            { value: "sync", label: "Sync" },
          ]}
        />
      </div>
      <div className="mt-4 grid gap-2">
        {visibleAlerts.length ? visibleAlerts.map((alert) => {
          const task = alert.taskId ? taskById.get(alert.taskId) : null;
          const tone = alert.severity === "critical" ? "red" : alert.severity === "warning" ? "amber" : "blue";
          return (
            <article key={alert.id} className="rounded-md border border-slate-200 p-3">
              <div className="flex items-start gap-2">
                <UiBadge tone={tone} size="xs" className="mt-0.5">{alert.severity === "critical" ? "kritisch" : alert.severity === "warning" ? "Warnung" : "Info"}</UiBadge>
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-950">{alert.title}</h3>
                  <p className="mt-1 text-xs leading-5 text-slate-600">{alert.description}</p>
                  <p className="mt-2 rounded-md bg-slate-50 px-2 py-1.5 text-xs font-semibold leading-5 text-slate-700">
                    Nächste Aktion: {alert.recommendedAction}
                  </p>
                  {task && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" onClick={() => onOpenTask(task)} className="text-xs font-semibold text-blue-600 hover:text-blue-700">{task.title}</button>
                      <UiButton disabled={pending || focusItems.length >= 3} onClick={() => onSetFocus(task, alert.recommendedAction, alert.focusStatus || "planned")} size="compact">Aktion in Fokus</UiButton>
                    </div>
                  )}
                  {task && hasOpenWaitingRelation(task.id, allTasks, taskRelations) && (
                    <p className="mt-2 text-[11px] font-semibold text-amber-700">Aufgabe wartet auf eine Abhängigkeit.</p>
                  )}
                </div>
              </div>
            </article>
          );
        }) : (
          <UiEmptyState tone="muted" className="px-4 py-8">Keine Hygiene Alerts offen.</UiEmptyState>
        )}
      </div>
    </UiPanel>
  );
}
