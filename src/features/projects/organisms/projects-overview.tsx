"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { InitiativeRaciList } from "@/features/projects/molecules/initiative-raci-list";
import { canDecideInitiativeApproval, isProposedDeliverable } from "@/features/planning/model/approval-domain";
import { buildProjectsFilterViewModel, DEFAULT_PROJECTS_FILTERS, type ProjectsRiskFilter, type ProjectsSort, type ProjectsTableFilters } from "@/features/projects/model/projects-filter-view-model";
import { TaskReferenceLink } from "@/features/tasks/atoms/task-reference-link";
import { dateRange, formatDate, initiativeMetaLabel, taskAssigneeLabel } from "@/lib/display";
import { normalizeStatus, taskStatuses } from "@/lib/status";
import type { ApprovalDecisionAction, Package, PlanningData, Profile, Task } from "@/lib/types";
import { UiBadge, UiButton, UiEmptyState, UiPanel } from "@/shared/atoms/ui-primitives";
import { FilterField, FilterToolbar, type ActiveFilter } from "@/shared/molecules/filter-toolbar";
import { ColumnFilterPopover } from "@/shared/molecules/column-filter-popover";
import { DataCell, DataColumnHeader, DataEmptyRow, DataRow, DataTableFrame, DataTableHead, type SortDirection } from "@/shared/molecules/data-surface";
import { dateUrlField, enumUrlField, stringUrlField, useTableUrlState, type TableUrlSchema } from "@/shared/hooks/use-table-url-state";

const projectsFilterSchema: TableUrlSchema<ProjectsTableFilters> = {
  query: stringUrlField(),
  owner: stringUrlField("Alle"),
  status: stringUrlField("Alle"),
  priority: stringUrlField("Alle"),
  milestone: stringUrlField("Alle"),
  initiative: stringUrlField("Alle"),
  risk: enumUrlField("all", ["all", "blocked", "critical", "github"] as const),
  from: dateUrlField(),
  to: dateUrlField(),
  sort: enumUrlField("title", ["title", "owner", "status", "priority", "hours", "date"] as const),
  direction: enumUrlField("asc", ["asc", "desc"] as const),
};

export function ProjectsOverview({
  data,
  tasks,
  currentProfile,
  canManageInitiatives,
  onEditInitiative,
  onOpenTask,
  onDecideInitiative,
}: {
  data: PlanningData;
  tasks: Task[];
  currentProfile?: Profile | null;
  canManageInitiatives: boolean;
  onEditInitiative: (initiative: Package) => void;
  onOpenTask: (taskId: string) => void;
  onDecideInitiative: (initiative: Package, action: ApprovalDecisionAction, note?: string) => void;
}) {
  const [openMilestoneIds, setOpenMilestoneIds] = useState<Set<string>>(new Set());
  const [openInitiativeIds, setOpenInitiativeIds] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { state: filters, updateState: updateFilters, resetState: resetFilters } = useTableUrlState({ namespace: "deliverables", schema: projectsFilterSchema });
  const profileName = (profileId?: string) => data.profiles.find((profile) => profile.id === profileId)?.name || "Nicht gesetzt";
  const filterViewModel = buildProjectsFilterViewModel({ data, tasks, filters });
  const isDirty = JSON.stringify(filters) !== JSON.stringify(DEFAULT_PROJECTS_FILTERS);
  const riskLabels: Record<ProjectsRiskFilter, string> = { all: "Alle Risiken", blocked: "Blockiert", critical: "Kritisch", github: "GitHub fehlt" };
  const activeFilters: ActiveFilter[] = [
    ...(filters.owner !== "Alle" ? [{ id: "owner", label: `Owner: ${profileName(filters.owner)}`, onRemove: () => updateFilters({ owner: "Alle" }) }] : []),
    ...(filters.status !== "Alle" ? [{ id: "status", label: `Status: ${filters.status}`, onRemove: () => updateFilters({ status: "Alle" }) }] : []),
    ...(filters.priority !== "Alle" ? [{ id: "priority", label: `Priorität: ${filters.priority}`, onRemove: () => updateFilters({ priority: "Alle" }) }] : []),
    ...(filters.milestone !== "Alle" ? [{ id: "milestone", label: `Meilenstein: ${data.milestones.find((milestone) => milestone.id === filters.milestone)?.title || filters.milestone}`, onRemove: () => updateFilters({ milestone: "Alle" }) }] : []),
    ...(filters.initiative !== "Alle" ? [{ id: "initiative", label: `Initiative: ${data.packages.find((pack) => pack.id === filters.initiative)?.title || filters.initiative}`, onRemove: () => updateFilters({ initiative: "Alle" }) }] : []),
    ...(filters.risk !== "all" ? [{ id: "risk", label: `Risiko: ${riskLabels[filters.risk]}`, onRemove: () => updateFilters({ risk: "all" }) }] : []),
    ...(filters.from ? [{ id: "from", label: `Ziel ab: ${filters.from}`, onRemove: () => updateFilters({ from: "" }) }] : []),
    ...(filters.to ? [{ id: "to", label: `Ziel bis: ${filters.to}`, onRemove: () => updateFilters({ to: "" }) }] : []),
  ];
  const filtersActive = Boolean(filters.query || activeFilters.length);
  const ownerOptions = [{ value: "Alle", label: "Alle Owner" }, ...data.profiles.map((profile) => ({ value: profile.id, label: profile.name }))];
  const statusOptions = [{ value: "Alle", label: "Alle Status" }, ...taskStatuses.map((status) => ({ value: status, label: status }))];
  const priorityOptions = ["Alle", "P0", "P1", "P2", "P3", "P4"].map((value) => ({ value, label: value === "Alle" ? "Alle Prioritäten" : value }));
  const milestoneOptions = [{ value: "Alle", label: "Alle Meilensteine" }, ...data.milestones.map((milestone) => ({ value: milestone.id, label: milestone.title }))];
  const initiativeOptions = [{ value: "Alle", label: "Alle Initiativen" }, ...data.packages.map((pack) => ({ value: pack.id, label: pack.title }))];
  const riskOptions = (Object.keys(riskLabels) as ProjectsRiskFilter[]).map((value) => ({ value, label: riskLabels[value] }));
  const proposedInitiatives = data.packages.filter((initiative) => initiative.approvalStatus === "proposed");
  const proposedDeliverables = tasks.filter(isProposedDeliverable);

  return (
    <div className="grid gap-4">
      <FilterToolbar
        searchLabel="Meilensteine und Deliverables durchsuchen"
        searchPlaceholder="Initiative, Deliverable oder Bereich suchen"
        query={filters.query}
        onQueryChange={(query) => updateFilters({ query }, "replace")}
        expanded={filtersOpen}
        onExpandedChange={setFiltersOpen}
        activeFilters={activeFilters}
        isDirty={isDirty}
        onReset={resetFilters}
        results={[{ id: "deliverables", visibleCount: filterViewModel.visibleCount, totalCount: filterViewModel.totalCount }]}
        panelId="project-data-filters"
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <FilterField label="Owner"><CustomSelect aria-label="Nach Owner filtern" value={filters.owner} onChange={(owner) => updateFilters({ owner })} className="h-10 text-sm" options={ownerOptions} /></FilterField>
          <FilterField label="Status"><CustomSelect aria-label="Nach Deliverable-Status filtern" value={filters.status} onChange={(status) => updateFilters({ status })} className="h-10 text-sm" options={statusOptions} /></FilterField>
          <FilterField label="Priorität"><CustomSelect aria-label="Nach Deliverable-Priorität filtern" value={filters.priority} onChange={(priority) => updateFilters({ priority })} className="h-10 text-sm" options={priorityOptions} /></FilterField>
          <FilterField label="Meilenstein"><CustomSelect aria-label="Nach Meilenstein filtern" value={filters.milestone} onChange={(milestone) => updateFilters({ milestone })} className="h-10 text-sm" options={milestoneOptions} /></FilterField>
          <FilterField label="Initiative"><CustomSelect aria-label="Nach Initiative filtern" value={filters.initiative} onChange={(initiative) => updateFilters({ initiative })} className="h-10 text-sm" options={initiativeOptions} /></FilterField>
          <FilterField label="Risiko"><CustomSelect aria-label="Nach Deliverable-Risiko filtern" value={filters.risk} onChange={(risk) => updateFilters({ risk: risk as ProjectsRiskFilter })} className="h-10 text-sm" options={riskOptions} /></FilterField>
          <FilterField label="Zieltermin von"><CustomDatePicker aria-label="Deliverables ab Zieltermin filtern" value={filters.from} onChange={(from) => updateFilters({ from })} className="h-10" /></FilterField>
          <FilterField label="Zieltermin bis"><CustomDatePicker aria-label="Deliverables bis Zieltermin filtern" value={filters.to} onChange={(to) => updateFilters({ to })} className="h-10" /></FilterField>
        </div>
      </FilterToolbar>
      <UiPanel>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aktives Projekt</div>
        <h2 className="mt-1 text-lg font-semibold text-slate-950">{data.project.name}</h2>
        <p className="mt-1 text-sm text-slate-500">Struktur: Epic / Meilenstein → Initiative → Deliverable → Sub-Issue. Sprints sind der Zeitcontainer für Deliverables.</p>
      </UiPanel>
      <section className="grid gap-3 lg:grid-cols-2">
        <UiPanel>
          <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Proposed Initiatives</div>
          <div className="mt-3 grid gap-2">
            {proposedInitiatives.map((initiative) => (
              <div key={initiative.id} className="rounded-md border border-slate-200 p-3">
                <div className="font-semibold text-slate-950">{initiative.title}</div>
                <div className="mt-1 text-xs text-slate-500">Revision {initiative.approvalRevision} · Antrag: {profileName(initiative.proposedById)}</div>
                {canDecideInitiativeApproval(initiative, currentProfile) && (
                  <div className="mt-2 flex gap-2">
                    <UiButton size="xs" variant="primary" onClick={() => onDecideInitiative(initiative, "approve")}>Freigeben</UiButton>
                    <UiButton size="xs" onClick={() => onDecideInitiative(initiative, "reject")}>Ablehnen</UiButton>
                  </div>
                )}
              </div>
            ))}
            {!proposedInitiatives.length && <p className="text-sm text-slate-500">Keine Initiative wartet auf Freigabe.</p>}
          </div>
        </UiPanel>
        <UiPanel>
          <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Proposed Deliverables</div>
          <div className="mt-3 grid gap-2">
            {proposedDeliverables.map((task) => (
              <button key={task.id} type="button" onClick={() => onOpenTask(task.id)} className="rounded-md border border-slate-200 p-3 text-left hover:bg-slate-50">
                <span className="block font-semibold text-slate-950">{task.title}</span>
                <span className="mt-1 block text-xs text-slate-500">Revision {task.approvalRevision} · {data.packages.find((pack) => pack.id === task.packageId)?.title || "Ohne Initiative"}</span>
              </button>
            ))}
            {!proposedDeliverables.length && <p className="text-sm text-slate-500">Kein Deliverable wartet auf Freigabe.</p>}
          </div>
        </UiPanel>
      </section>
      <section className="grid gap-3">
        {filterViewModel.hierarchy.map(({ milestone, initiatives: groups, tasks: milestoneTasks }) => {
          const milestoneKey = milestone.id || "without-epic";
          const isMilestoneOpen = filtersActive || openMilestoneIds.has(milestoneKey);
          const blocked = milestoneTasks.filter((task) => task.dependsOn || normalizeStatus(task.status) === "Blockiert").length;
          const effort = milestoneTasks.reduce((sum, task) => sum + task.hours, 0);

          return (
            <UiPanel key={milestoneKey} as="article" padding="none" className="overflow-hidden">
              <button
                type="button"
                onClick={() => setOpenMilestoneIds((current) => toggleSetValue(current, milestoneKey))}
                className="flex w-full items-start justify-between gap-3 px-4 py-4 text-left hover:bg-slate-50"
                aria-expanded={isMilestoneOpen}
              >
                <span className="flex min-w-0 gap-3">
                  <span className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500">
                    {isMilestoneOpen ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                  </span>
                  <span className="min-w-0">
                    <span className="text-xs font-semibold uppercase tracking-wide text-blue-700">Epic / Meilenstein</span>
                    <span className="mt-1 block truncate text-base font-semibold text-slate-950">{milestone.title}</span>
                    <span className="mt-1 block text-sm leading-6 text-slate-600">{milestone.description}</span>
                  </span>
                </span>
                <span className="grid shrink-0 grid-cols-4 gap-3 text-right text-xs text-slate-500">
                  <span><span className="block font-semibold text-slate-900">{groups.length}</span> Initiativen</span>
                  <span><span className="block font-semibold text-slate-900">{milestoneTasks.length}</span> Deliverables</span>
                  <span><span className="block font-semibold text-slate-900">{blocked}</span> Blockiert</span>
                  <span><span className="block font-semibold text-slate-900">{effort}h</span> Aufwand</span>
                </span>
              </button>
              {isMilestoneOpen && (
                <div className="grid gap-3 border-t border-slate-100 bg-slate-50 p-3">
                  {groups.map(({ initiative: pack, tasks: initiativeTasks }) => (
                    <InitiativeTreeItem
                      key={pack.id}
                      data={data}
                      initiative={pack}
                      tasks={initiativeTasks}
                      profileName={profileName}
                      isOpen={filtersActive || openInitiativeIds.has(pack.id)}
                      canEdit={canManageInitiatives || pack.ownerId === currentProfile?.id}
                      onToggle={() => setOpenInitiativeIds((current) => toggleSetValue(current, pack.id))}
                      onEdit={() => onEditInitiative(pack)}
                      onOpenTask={onOpenTask}
                      filters={filters}
                      onFiltersChange={updateFilters}
                      ownerOptions={ownerOptions}
                      statusOptions={statusOptions}
                      priorityOptions={priorityOptions}
                    />
                  ))}
                  {!groups.length && (
                    <UiEmptyState className="rounded-lg px-4 py-6">
                      Noch keine Initiativen in diesem Epic.
                    </UiEmptyState>
                  )}
                </div>
              )}
            </UiPanel>
          );
        })}
        {!filterViewModel.hierarchy.length && (
          <UiEmptyState>
            {filterViewModel.totalCount ? "Keine Meilensteine, Initiativen oder Deliverables für diese Filter." : "Noch keine Meilensteine, Initiativen oder Deliverables vorhanden."}
          </UiEmptyState>
        )}
      </section>
    </div>
  );
}

function InitiativeTreeItem({
  data,
  initiative,
  tasks,
  profileName,
  isOpen,
  canEdit,
  onToggle,
  onEdit,
  onOpenTask,
  filters,
  onFiltersChange,
  ownerOptions,
  statusOptions,
  priorityOptions,
}: {
  data: PlanningData;
  initiative: Package;
  tasks: Task[];
  profileName: (profileId?: string) => string;
  isOpen: boolean;
  canEdit: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onOpenTask: (taskId: string) => void;
  filters: ProjectsTableFilters;
  onFiltersChange: (patch: Partial<ProjectsTableFilters>) => void;
  ownerOptions: Array<{ value: string; label: string }>;
  statusOptions: Array<{ value: string; label: string }>;
  priorityOptions: Array<{ value: string; label: string }>;
}) {
  const done = tasks.filter((task) => normalizeStatus(task.status) === "Erledigt").length;
  const blocked = tasks.filter((task) => task.dependsOn || normalizeStatus(task.status) === "Blockiert").length;
  const effort = tasks.reduce((sum, task) => sum + task.hours, 0);

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex items-start justify-between gap-3 p-3">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 gap-2 text-left" aria-expanded={isOpen}>
          <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500">
            {isOpen ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
          </span>
          <span className="min-w-0">
            <span className="text-xs font-semibold text-blue-700">{initiativeMetaLabel(initiative)}</span>
            <span className="ml-2 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-800">{initiative.approvalStatus}</span>
            <span className="mt-1 block truncate text-sm font-semibold text-slate-950">{initiative.title}</span>
            <span className="mt-1 block text-xs text-slate-500">Owner: {profileName(initiative.ownerId)}{initiative.targetDate ? ` · Zieltermin: ${formatDate(initiative.targetDate)}` : ""}</span>
            <span className="mt-2 block text-sm leading-6 text-slate-600">{initiative.goal}</span>
          </span>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <UiBadge tone="white">{tasks.length} Deliverables</UiBadge>
          <UiBadge tone="orange">{blocked} blockiert</UiBadge>
          {canEdit && (
            <UiButton onClick={onEdit} size="xs">
              Bearbeiten
            </UiButton>
          )}
        </div>
      </div>
      {isOpen && (
        <div className="grid gap-3 border-t border-slate-100 p-3">
          <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_minmax(420px,2fr)]">
            <div className="grid gap-2">
              <InitiativeRaciList initiative={initiative} profiles={data.profiles} className="grid gap-1 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600" />
              {initiative.successCriteria && (
                <p className="text-xs leading-5 text-slate-500"><span className="font-semibold text-slate-700">Erfolgskriterien:</span> {initiative.successCriteria}</p>
              )}
              {initiative.scopeConstraints && (
                <p className="text-xs leading-5 text-slate-500"><span className="font-semibold text-slate-700">Constraints:</span> {initiative.scopeConstraints}</p>
              )}
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-md bg-slate-50 p-2"><div className="text-xs text-slate-500">Erledigt</div><div className="font-semibold text-slate-900">{done}</div></div>
                <div className="rounded-md bg-slate-50 p-2"><div className="text-xs text-slate-500">Blockiert</div><div className="font-semibold text-slate-900">{blocked}</div></div>
                <div className="rounded-md bg-slate-50 p-2"><div className="text-xs text-slate-500">Aufwand</div><div className="font-semibold text-slate-900">{effort}h</div></div>
              </div>
            </div>
            <DeliverableTable tasks={tasks} totalCount={data.tasks.filter((task) => task.packageId === initiative.id && task.taskType !== "sub_issue").length} onOpenTask={onOpenTask} filters={filters} onFiltersChange={onFiltersChange} ownerOptions={ownerOptions} statusOptions={statusOptions} priorityOptions={priorityOptions} />
          </div>
        </div>
      )}
    </div>
  );
}

function DeliverableTable({
  tasks,
  totalCount,
  onOpenTask,
  filters,
  onFiltersChange,
  ownerOptions,
  statusOptions,
  priorityOptions,
}: {
  tasks: Task[];
  totalCount: number;
  onOpenTask: (taskId: string) => void;
  filters: ProjectsTableFilters;
  onFiltersChange: (patch: Partial<ProjectsTableFilters>) => void;
  ownerOptions: Array<{ value: string; label: string }>;
  statusOptions: Array<{ value: string; label: string }>;
  priorityOptions: Array<{ value: string; label: string }>;
}) {
  const toggleSort = (sort: ProjectsSort) => onFiltersChange({ sort, direction: filters.sort === sort && filters.direction === "asc" ? "desc" : "asc" });
  const directionFor = (sort: ProjectsSort): SortDirection => filters.sort === sort ? filters.direction : null;
  return (
    <DataTableFrame title="Deliverables" caption="Deliverables der Initiative" results={[{ id: "deliverables", visibleCount: tasks.length, totalCount }]} filtering={{ mode: "external", labelledBy: "project-data-filters" }} minWidth={760}>
      <DataTableHead>
        <tr>
          <DataColumnHeader label="Deliverable" direction={directionFor("title")} onSort={() => toggleSort("title")} sticky filter={<ColumnFilterPopover label="Deliverables nach Priorität filtern" activeCount={filters.priority === "Alle" ? 0 : 1} onReset={() => onFiltersChange({ priority: "Alle" })}><CustomSelect aria-label="Priorität wählen" value={filters.priority} onChange={(priority) => onFiltersChange({ priority })} options={priorityOptions} className="h-10" /></ColumnFilterPopover>} />
          <DataColumnHeader label="Owner" direction={directionFor("owner")} onSort={() => toggleSort("owner")} filter={<ColumnFilterPopover label="Deliverables nach Owner filtern" activeCount={filters.owner === "Alle" ? 0 : 1} onReset={() => onFiltersChange({ owner: "Alle" })}><CustomSelect aria-label="Owner wählen" value={filters.owner} onChange={(owner) => onFiltersChange({ owner })} options={ownerOptions} className="h-10" /></ColumnFilterPopover>} />
          <DataColumnHeader label="Status" direction={directionFor("status")} onSort={() => toggleSort("status")} filter={<ColumnFilterPopover label="Deliverables nach Status filtern" activeCount={filters.status === "Alle" ? 0 : 1} onReset={() => onFiltersChange({ status: "Alle" })}><CustomSelect aria-label="Status wählen" value={filters.status} onChange={(status) => onFiltersChange({ status })} options={statusOptions} className="h-10" /></ColumnFilterPopover>} />
          <DataColumnHeader label="Aufwand" direction={directionFor("hours")} onSort={() => toggleSort("hours")} />
          <DataColumnHeader label="Zeitraum" direction={directionFor("date")} onSort={() => toggleSort("date")} filter={<ColumnFilterPopover label="Deliverables nach Zieltermin filtern" activeCount={(filters.from ? 1 : 0) + (filters.to ? 1 : 0)} onReset={() => onFiltersChange({ from: "", to: "" })}><div className="grid gap-3"><CustomDatePicker aria-label="Zieltermin von" value={filters.from} onChange={(from) => onFiltersChange({ from })} className="h-10" /><CustomDatePicker aria-label="Zieltermin bis" value={filters.to} onChange={(to) => onFiltersChange({ to })} className="h-10" /></div></ColumnFilterPopover>} />
        </tr>
      </DataTableHead>
      <tbody>
      {tasks.map((task) => (
        <DataRow key={task.id}>
          <DataCell className="min-w-0" sticky>
            <TaskReferenceLink task={task} onOpenTask={onOpenTask} className="max-w-full font-semibold text-slate-950">
              <span className="block truncate">{task.title}</span>
            </TaskReferenceLink>
            <span className="mt-0.5 block text-xs text-slate-500">{task.priority} · {task.workstream || "ohne Bereich"}</span>
          </DataCell>
          <DataCell className="truncate text-slate-700">{taskAssigneeLabel(task)}</DataCell>
          <DataCell className="text-slate-700">{task.approvalStatus === "approved" ? normalizeStatus(task.status) : task.approvalStatus}</DataCell>
          <DataCell className="text-slate-700">{task.hours}h</DataCell>
          <DataCell className="truncate text-slate-700">{dateRange(task)}</DataCell>
        </DataRow>
      ))}
      {!tasks.length && <DataEmptyRow colSpan={5}>{totalCount ? "Keine Deliverables für diese Filter." : "Noch keine Deliverables in dieser Initiative."}</DataEmptyRow>}
      </tbody>
    </DataTableFrame>
  );
}

function toggleSetValue(current: Set<string>, value: string) {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
