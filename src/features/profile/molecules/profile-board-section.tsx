import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PlanningState } from "@/features/planning/model/planning-state";
import { Check, ChevronDown } from "lucide-react";
import type { AppWorkspace } from "@/features/planning/organisms/app-sidebar";
import type { ProfileSettingsDraft } from "@/features/profile/model/profile-settings-view-model";
import { SettingsPane, SettingsRow } from "@/features/profile/molecules/profile-settings-layout";
import type { PlanningFilterPreferences, ViewMode } from "@/lib/types";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { classNames, UiButton, UiEmptyState, UiField, UiTextInput } from "@/shared/atoms/ui-primitives";
import { FilterToggleGroup } from "@/shared/molecules/filter-toolbar";

export function BoardSettingsSection({
  advancedBoardOpen,
  planningState,
  draft,
  assigneeOptions,
  priorityOptions,
  quickFilterOptions,
  statusOptions,
  viewOptions,
  workspaceOptions,
  onAdvancedBoardOpenChange,
  onDefaultTaskViewChange,
  onDefaultWorkspaceChange,
  onInitiativeToggle,
  onPlanningFiltersChange,
}: {
  advancedBoardOpen: boolean;
  planningState: PlanningState;
  draft: ProfileSettingsDraft;
  assigneeOptions: Array<{ value: string; label: string }>;
  priorityOptions: Array<{ value: string; label: string }>;
  quickFilterOptions: Array<{ value: string; label: string }>;
  statusOptions: Array<{ value: string; label: string }>;
  viewOptions: Array<{ value: string; label: string }>;
  workspaceOptions: Array<{ value: string; label: string }>;
  onAdvancedBoardOpenChange: (open: boolean) => void;
  onDefaultTaskViewChange: (view: ViewMode) => void;
  onDefaultWorkspaceChange: (workspace: AppWorkspace) => void;
  onInitiativeToggle: (initiativeId: string) => void;
  onPlanningFiltersChange: (patch: Partial<PlanningFilterPreferences>) => void;
}) {
  const [search, setSearch] = useState("");
  const normalizedSearch = search.trim().toLocaleLowerCase("de");
  const query = useMemo(() => ({ view: "candidates" as const, kind: "initiative" as const, query: normalizedSearch, limit: 20 }), [normalizedSearch]);
  const demand = useRef<AbortController | null>(null);
  const explicit = useRef(true);
  const candidates = useSyncExternalStore(planningState.subscribe, () => planningState.candidates(query), () => planningState.candidates(query));
  useEffect(() => {
    if (!advancedBoardOpen) return;
    const controller = new AbortController(); demand.current = controller;
    void planningState.loadCandidates(query, { immediate: explicit.current, signal: controller.signal });
    return () => { controller.abort(); if (demand.current === controller) demand.current = null; };
  }, [planningState, advancedBoardOpen, query]);
  const submit = (refresh = false) => {
    if (demand.current) void planningState.loadCandidates(query, { immediate: true, refresh, signal: demand.current.signal });
  };
  const currentItems = candidates.readStatus === "current" ? candidates.items : [];
  const retainedIds = new Set([...draft.expandedInitiativeIds, ...(draft.planningFilters.initiativeId !== "Alle" ? [draft.planningFilters.initiativeId] : [])]);
  const initiatives = [...currentItems.map(item => ({ id: item.id, title: item.title })),
    ...[...retainedIds].filter(id => id && !currentItems.some(item => item.id === id)).map(id => ({ id, title: planningState.candidate(id)?.title || `Gespeicherte Initiative (${id})` }))];
  const initiativeOptions = [{ value: "Alle", label: "Alle" }, ...initiatives.map(item => ({ value: item.id, label: item.title }))];
  const changeSearch = (value: string) => { explicit.current = false; setSearch(value.slice(0, 2048)); };
  return (
    <SettingsPane eyebrow="Planung" title="Planungs-Defaults" description="Legt fest, wo die App startet und wie die Planung standardmäßig dargestellt wird.">
      <SettingsRow label="Startbereich" description="Bereich, der beim Öffnen der App startet.">
        <CustomSelect aria-label="Startbereich" value={draft.defaultWorkspace} onChange={(value) => onDefaultWorkspaceChange(value as AppWorkspace)} options={workspaceOptions} className="h-9 text-sm md:min-w-80" />
      </SettingsRow>
      <SettingsRow label="Standardansicht für Planung" description="Darstellung beim Öffnen des Bereichs Planung.">
        <CustomSelect aria-label="Standardansicht für Planung" value={draft.defaultTaskView} onChange={(value) => onDefaultTaskViewChange(value as ViewMode)} options={viewOptions} className="h-9 text-sm md:min-w-80" />
      </SettingsRow>
      <div data-profile-advanced-board-defaults={advancedBoardOpen ? "open" : "closed"}>
        <SettingsRow label="Erweiterte Planungs-Defaults" description="Optionale Filter und aufgeklappte Initiativen für die Planung.">
          <UiButton onClick={() => { if (!advancedBoardOpen) explicit.current = true; onAdvancedBoardOpenChange(!advancedBoardOpen); }} className="min-w-44 justify-between">
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
                  <CustomSelect aria-label="Zuständig" value={draft.planningFilters.assignee} onChange={(assignee) => onPlanningFiltersChange({ assignee })} options={assigneeOptions} className="h-9 text-sm" />
                </UiField>
                <UiField as="div">
                  Status
                  <CustomSelect aria-label="Status" value={draft.planningFilters.status} onChange={(status) => onPlanningFiltersChange({ status })} options={statusOptions} className="h-9 text-sm" />
                </UiField>
                <UiField as="div">
                  Priorität
                  <CustomSelect aria-label="Priorität" value={draft.planningFilters.priority} onChange={(priority) => onPlanningFiltersChange({ priority })} options={priorityOptions} className="h-9 text-sm" />
                </UiField>
                <UiField as="div">
                  Initiative
                  <CustomSelect aria-label="Initiative" value={draft.planningFilters.initiativeId} onChange={(initiativeId) => onPlanningFiltersChange({ initiativeId })} options={initiativeOptions}
                    search={{ label: "Initiative suchen", value: search, onChange: changeSearch, onSubmit: () => submit() }} className="h-9 text-sm" />
                </UiField>
                <UiField as="div" className="md:col-span-2">
                  Schnellfilter kombinieren
                  <FilterToggleGroup
                    label="Standard-Schnellfilter"
                    values={draft.planningFilters.quick}
                    options={quickFilterOptions}
                    onChange={(quick) => onPlanningFiltersChange({ quick })}
                  />
                </UiField>
                <UiField>
                  Suche
                  <UiTextInput value={draft.planningFilters.query} onChange={(event) => onPlanningFiltersChange({ query: event.target.value })} inputPadding="md" />
                </UiField>
              </div>
            </SettingsRow>
            <SettingsRow label="Aufgeklappte Initiativen" description="Nur die Initiativen, die beim Öffnen direkt sichtbar sein sollen." align="start">
              <div className="grid gap-2 md:max-w-2xl">
                <UiTextInput aria-label="Initiativen suchen" value={search} onChange={event => changeSearch(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); submit(); } }} />
                {candidates.readStatus === "not-loaded" || candidates.readStatus === "loading" ? <p role="status" className="text-sm text-slate-600">Initiativen werden geladen.</p>
                  : candidates.readStatus !== "current" ? <div><p role="status" className="text-sm text-slate-600">Initiativen sind derzeit nicht aktuell verfügbar. Gespeicherte Auswahlen bleiben erhalten.</p><UiButton onClick={() => submit(true)}>Initiativen erneut laden</UiButton></div> : null}
                <div className="flex flex-wrap justify-start gap-2">
                {initiatives.map((initiative) => {
                  const selected = draft.expandedInitiativeIds.includes(initiative.id);
                  return (
                    <button
                      key={initiative.id}
                      type="button"
                      onClick={() => onInitiativeToggle(initiative.id)}
                      className={classNames(
                        "inline-flex h-8 max-w-full items-center gap-2 rounded-md border px-2 text-xs font-semibold",
                        selected ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                      )}
                    >
                      {selected && <Check size={13} />}
                      <span className="truncate">{initiative.title}</span>
                    </button>
                  );
                })}
                </div>
                {candidates.readStatus === "current" && candidates.coverage === "complete" && candidates.total === 0 && <UiEmptyState className="w-full">Keine Initiativen vorhanden.</UiEmptyState>}
                {candidates.readStatus === "current" && candidates.continuation && <UiButton disabled={candidates.furtherReadStatus === "loading"} onClick={() => { if (demand.current && candidates.continuation) void planningState.loadCandidates({ ...query, continuation: candidates.continuation }, { immediate: true, signal: demand.current.signal }); }}>Weitere Initiativen laden</UiButton>}
              </div>
            </SettingsRow>
          </div>
        )}
      </div>
    </SettingsPane>
  );
}
