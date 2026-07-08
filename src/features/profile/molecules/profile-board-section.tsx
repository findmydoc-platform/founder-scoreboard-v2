import { Check, ChevronDown } from "lucide-react";
import type { AppWorkspace } from "@/features/planning/organisms/app-sidebar";
import type { ProfileSettingsDraft } from "@/features/profile/model/profile-settings-view-model";
import { SettingsPane, SettingsRow } from "@/features/profile/molecules/profile-settings-layout";
import type { PlanningData, PlanningFilterPreferences, ViewMode } from "@/lib/types";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { classNames, UiButton, UiEmptyState, UiField, UiTextInput } from "@/shared/atoms/ui-primitives";

export function BoardSettingsSection({
  advancedBoardOpen,
  data,
  draft,
  assigneeOptions,
  packageOptions,
  priorityOptions,
  quickFilterOptions,
  statusOptions,
  viewOptions,
  workspaceOptions,
  onAdvancedBoardOpenChange,
  onCurrentBoardSave,
  onDefaultTaskViewChange,
  onDefaultWorkspaceChange,
  onPackageToggle,
  onPlanningFiltersChange,
}: {
  advancedBoardOpen: boolean;
  data: PlanningData;
  draft: ProfileSettingsDraft;
  assigneeOptions: Array<{ value: string; label: string }>;
  packageOptions: Array<{ value: string; label: string }>;
  priorityOptions: Array<{ value: string; label: string }>;
  quickFilterOptions: Array<{ value: string; label: string }>;
  statusOptions: Array<{ value: string; label: string }>;
  viewOptions: Array<{ value: string; label: string }>;
  workspaceOptions: Array<{ value: string; label: string }>;
  onAdvancedBoardOpenChange: (open: boolean) => void;
  onCurrentBoardSave: () => void;
  onDefaultTaskViewChange: (view: ViewMode) => void;
  onDefaultWorkspaceChange: (workspace: AppWorkspace) => void;
  onPackageToggle: (packageId: string) => void;
  onPlanningFiltersChange: (patch: Partial<PlanningFilterPreferences>) => void;
}) {
  return (
    <SettingsPane eyebrow="Board" title="Board-Defaults" description="Der Normalfall ist schnell: aktuelle Ansicht übernehmen. Details bleiben optional.">
      <SettingsRow label="Aktuelle Ansicht" description="Übernimmt Ansicht, Filter und aufgeklappte Initiativen aus dem Board.">
        <UiButton onClick={onCurrentBoardSave} variant="blueOutline">
          Aktuelle Board-Ansicht als Standard speichern
        </UiButton>
      </SettingsRow>
      <SettingsRow label="Startbereich" description="Wo du nach dem Öffnen der App landen möchtest.">
        <CustomSelect value={draft.defaultWorkspace} onChange={(value) => onDefaultWorkspaceChange(value as AppWorkspace)} options={workspaceOptions} className="h-9 text-sm md:min-w-80" />
      </SettingsRow>
      <SettingsRow label="Standardansicht" description="Die bevorzugte Board-Darstellung.">
        <CustomSelect value={draft.defaultTaskView} onChange={(value) => onDefaultTaskViewChange(value as ViewMode)} options={viewOptions} className="h-9 text-sm md:min-w-80" />
      </SettingsRow>
      <div data-profile-advanced-board-defaults={advancedBoardOpen ? "open" : "closed"}>
        <SettingsRow label="Erweiterte Board-Defaults" description="Filter und aufgeklappte Initiativen nur bei Bedarf bearbeiten.">
          <UiButton onClick={() => onAdvancedBoardOpenChange(!advancedBoardOpen)} className="min-w-44 justify-between">
            {advancedBoardOpen ? "Schließen" : "Öffnen"}
            <ChevronDown size={15} className={classNames("transition", advancedBoardOpen && "rotate-180")} />
          </UiButton>
        </SettingsRow>
        {advancedBoardOpen && (
          <div className="divide-y divide-slate-100 border-t border-slate-100">
            <SettingsRow label="Filter" align="start">
              <div className="grid gap-2 md:min-w-96 md:grid-cols-2">
                <UiField as="div">
                  Zuständig
                  <CustomSelect value={draft.planningFilters.assignee} onChange={(assignee) => onPlanningFiltersChange({ assignee })} options={assigneeOptions} className="h-9 text-sm" />
                </UiField>
                <UiField as="div">
                  Status
                  <CustomSelect value={draft.planningFilters.status} onChange={(status) => onPlanningFiltersChange({ status })} options={statusOptions} className="h-9 text-sm" />
                </UiField>
                <UiField as="div">
                  Priorität
                  <CustomSelect value={draft.planningFilters.priority} onChange={(priority) => onPlanningFiltersChange({ priority })} options={priorityOptions} className="h-9 text-sm" />
                </UiField>
                <UiField as="div">
                  Initiative
                  <CustomSelect value={draft.planningFilters.packageId} onChange={(packageId) => onPlanningFiltersChange({ packageId })} options={packageOptions} className="h-9 text-sm" />
                </UiField>
                <UiField as="div">
                  Schnellfilter
                  <CustomSelect value={draft.planningFilters.quick} onChange={(quick) => onPlanningFiltersChange({ quick })} options={quickFilterOptions} className="h-9 text-sm" />
                </UiField>
                <UiField>
                  Suche
                  <UiTextInput value={draft.planningFilters.query} onChange={(event) => onPlanningFiltersChange({ query: event.target.value })} inputPadding="md" />
                </UiField>
              </div>
            </SettingsRow>
            <SettingsRow label="Aufgeklappte Initiativen" description="Nur die Initiativen, die beim Öffnen direkt sichtbar sein sollen." align="start">
              <div className="flex flex-wrap justify-start gap-2 md:max-w-2xl">
                {data.packages.map((pack) => {
                  const selected = draft.expandedPackageIds.includes(pack.id);
                  return (
                    <button
                      key={pack.id}
                      type="button"
                      onClick={() => onPackageToggle(pack.id)}
                      className={classNames(
                        "inline-flex h-8 max-w-full items-center gap-2 rounded-md border px-2 text-xs font-semibold",
                        selected ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                      )}
                    >
                      {selected && <Check size={13} />}
                      <span className="truncate">{pack.title}</span>
                    </button>
                  );
                })}
                {!data.packages.length && <UiEmptyState className="w-full">Keine Initiativen vorhanden.</UiEmptyState>}
              </div>
            </SettingsRow>
          </div>
        )}
      </div>
    </SettingsPane>
  );
}
