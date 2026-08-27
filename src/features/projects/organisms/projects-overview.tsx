"use client";

import { ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { InitiativeRaciList } from "@/features/projects/molecules/initiative-raci-list";
import { ApprovalDecisionDialog } from "@/features/planning/molecules/approval-decision-dialog";
import { PlanningTrashActionDialog } from "@/features/planning/molecules/planning-trash-action-dialog";
import { canDecideInitiativeApproval, canReturnInitiativeForRevision, isProposedDeliverable } from "@/features/planning/model/approval-domain";
import { canWithdrawPlanningRoot, isWithdrawableApprovalStatus } from "@/features/planning/model/planning-trash-contract";
import { buildProjectsFilterViewModel, DEFAULT_PROJECTS_FILTERS, type ProjectsRiskFilter, type ProjectsSort, type ProjectsTableFilters } from "@/features/projects/model/projects-filter-view-model";
import type { EpicChildCounts } from "@/features/projects/model/epic-contract";
import { TaskReferenceLink } from "@/features/tasks/atoms/task-reference-link";
import { projectDeliverableSchedule } from "@/features/planning-items/model/deliverable-schedule";
import { dateRange, formatDate, initiativeMetaLabel, taskAssigneeLabel } from "@/lib/display";
import { normalizeStatus, priorityBadgeTone, taskStatuses } from "@/lib/status";
import type { ApprovalDecisionAction, PlanningShellState, Profile, Sprint, Task } from "@/lib/types";
import type { ApprovalReasonAction } from "@/lib/approval-decision-policy";
import { UiBadge, UiButton, UiEmptyState, UiPanel } from "@/shared/atoms/ui-primitives";
import { FilterField, FilterToolbar, type ActiveFilter } from "@/shared/molecules/filter-toolbar";
import { ColumnFilterPopover } from "@/shared/molecules/column-filter-popover";
import { DataCell, DataColumnHeader, DataEmptyRow, DataRow, DataTableFrame, DataTableHead, type SortDirection } from "@/shared/molecules/data-surface";
import { CustomActionMenu } from "@/shared/molecules/custom-action-menu";
import { dateUrlField, enumUrlField, stringUrlField, useTableUrlState, type TableUrlSchema } from "@/shared/hooks/use-table-url-state";

const projectsFilterSchema: TableUrlSchema<ProjectsTableFilters> = {
  query: stringUrlField(),
  owner: stringUrlField("Alle"),
  status: stringUrlField("Alle"),
  priority: stringUrlField("Alle"),
  epic: stringUrlField("Alle"),
  initiative: stringUrlField("Alle"),
  risk: enumUrlField("all", ["all", "blocked", "critical", "github"] as const),
  from: dateUrlField(),
  to: dateUrlField(),
  sort: enumUrlField("title", ["title", "owner", "status", "priority", "hours", "date"] as const),
  direction: enumUrlField("asc", ["asc", "desc"] as const),
};

function epicStatusMeta(status: string) {
  const normalized = normalizeStatus(status);
  if (normalized === "In Arbeit") return { label: normalized, tone: "blue" as const };
  if (normalized === "Erledigt") return { label: normalized, tone: "emerald" as const };
  return { label: normalized, tone: "slate" as const };
}

export function ProjectsOverview({
  data,
  tasks,
  currentProfile,
  canManageInitiatives,
  canManageEpics,
  pending,
  onCreateEpic,
  onDeleteEpic,
  onEditInitiative,
  onEditEpic,
  onOpenTask,
  onDecideInitiative,
  onWithdrawInitiative,
}: {
  data: PlanningShellState;
  tasks: Task[];
  currentProfile?: Profile | null;
  canManageInitiatives: boolean;
  canManageEpics: boolean;
  pending: boolean;
  onCreateEpic: () => void;
  onDeleteEpic: (epic: Task, children: EpicChildCounts) => void;
  onEditInitiative: (initiative: Task) => void;
  onEditEpic: (epic: Task) => void;
  onOpenTask: (taskId: string) => void;
  onDecideInitiative: (initiative: Task, action: ApprovalDecisionAction, note?: string) => void;
  onWithdrawInitiative: (initiative: Task, reason: string) => void;
}) {
  const [openEpicIds, setOpenEpicIds] = useState<Set<string>>(new Set());
  const [openInitiativeIds, setOpenInitiativeIds] = useState<Set<string>>(new Set());
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [approvalDecision, setApprovalDecision] = useState<{ initiative: Task; action: ApprovalReasonAction } | null>(null);
  const [withdrawal, setWithdrawal] = useState<Task | null>(null);
  const { state: filters, updateState: updateFilters, resetState: resetFilters } = useTableUrlState({ namespace: "deliverables", schema: projectsFilterSchema });
  const profileName = (profileId?: string) => data.profiles.find((profile) => profile.id === profileId)?.name || "Nicht gesetzt";
  const filterViewModel = buildProjectsFilterViewModel({ data, tasks, filters });
  const epics = tasks.filter((item) => item.taskType === "epic");
  const initiatives = tasks.filter((item) => item.taskType === "initiative");
  const isDirty = JSON.stringify(filters) !== JSON.stringify(DEFAULT_PROJECTS_FILTERS);
  const riskLabels: Record<ProjectsRiskFilter, string> = { all: "Alle Risiken", blocked: "Blockiert", critical: "Kritisch", github: "GitHub fehlt" };
  const activeFilters: ActiveFilter[] = [
    ...(filters.owner !== "Alle" ? [{ id: "owner", label: `Owner: ${profileName(filters.owner)}`, onRemove: () => updateFilters({ owner: "Alle" }) }] : []),
    ...(filters.status !== "Alle" ? [{ id: "status", label: `Status: ${filters.status}`, onRemove: () => updateFilters({ status: "Alle" }) }] : []),
    ...(filters.priority !== "Alle" ? [{ id: "priority", label: `Priorität: ${filters.priority}`, onRemove: () => updateFilters({ priority: "Alle" }) }] : []),
    ...(filters.epic !== "Alle" ? [{ id: "epic", label: `Epic: ${epics.find((epic) => epic.id === filters.epic)?.title || filters.epic}`, onRemove: () => updateFilters({ epic: "Alle" }) }] : []),
    ...(filters.initiative !== "Alle" ? [{ id: "initiative", label: `Initiative: ${initiatives.find((initiative) => initiative.id === filters.initiative)?.title || filters.initiative}`, onRemove: () => updateFilters({ initiative: "Alle" }) }] : []),
    ...(filters.risk !== "all" ? [{ id: "risk", label: `Risiko: ${riskLabels[filters.risk]}`, onRemove: () => updateFilters({ risk: "all" }) }] : []),
    ...(filters.from ? [{ id: "from", label: `Ziel ab: ${filters.from}`, onRemove: () => updateFilters({ from: "" }) }] : []),
    ...(filters.to ? [{ id: "to", label: `Ziel bis: ${filters.to}`, onRemove: () => updateFilters({ to: "" }) }] : []),
  ];
  const filtersActive = Boolean(filters.query || activeFilters.length);
  const ownerOptions = [{ value: "Alle", label: "Alle Owner" }, ...data.profiles.map((profile) => ({ value: profile.id, label: profile.name }))];
  const statusOptions = [{ value: "Alle", label: "Alle Status" }, ...taskStatuses.map((status) => ({ value: status, label: status }))];
  const priorityOptions = ["Alle", "P0", "P1", "P2", "P3", "P4"].map((value) => ({ value, label: value === "Alle" ? "Alle Prioritäten" : value }));
  const epicOptions = [{ value: "Alle", label: "Alle Epics" }, ...epics.map((epic) => ({ value: epic.id, label: epic.title }))];
  const initiativeOptions = [{ value: "Alle", label: "Alle Initiativen" }, ...initiatives.map((initiative) => ({ value: initiative.id, label: initiative.title }))];
  const riskOptions = (Object.keys(riskLabels) as ProjectsRiskFilter[]).map((value) => ({ value, label: riskLabels[value] }));
  const pendingInitiatives = initiatives.filter((initiative) => isWithdrawableApprovalStatus(initiative.approvalStatus));
  const proposedDeliverables = tasks.filter(isProposedDeliverable);

  useEffect(() => {
    const epicIds = new Set(epics.map((epic) => epic.id));
    const hasOrphans = initiatives.some((initiative) => !initiative.parentTaskId || !epicIds.has(initiative.parentTaskId));
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setOpenEpicIds((current) => {
        const next = new Set(Array.from(current).filter((id) => epicIds.has(id) || id === "without-epic" && hasOrphans));
        return next.size === current.size && Array.from(next).every((id) => current.has(id)) ? current : next;
      });
      if (filters.epic !== "Alle" && !epicIds.has(filters.epic)) {
        updateFilters({ epic: "Alle" }, "replace");
      }
    });
    return () => { cancelled = true; };
  }, [epics, filters.epic, initiatives, updateFilters]);

  return (
    <div className="grid gap-4">
      <FilterToolbar
        searchLabel="Epics und Deliverables durchsuchen"
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
          <FilterField label="Epic"><CustomSelect aria-label="Nach Epic filtern" value={filters.epic} onChange={(epic) => updateFilters({ epic })} className="h-10 text-sm" options={epicOptions} /></FilterField>
          <FilterField label="Initiative"><CustomSelect aria-label="Nach Initiative filtern" value={filters.initiative} onChange={(initiative) => updateFilters({ initiative })} className="h-10 text-sm" options={initiativeOptions} /></FilterField>
          <FilterField label="Risiko"><CustomSelect aria-label="Nach Deliverable-Risiko filtern" value={filters.risk} onChange={(risk) => updateFilters({ risk: risk as ProjectsRiskFilter })} className="h-10 text-sm" options={riskOptions} /></FilterField>
          <FilterField label="Zieltermin von"><CustomDatePicker aria-label="Deliverables ab Zieltermin filtern" value={filters.from} onChange={(from) => updateFilters({ from })} className="h-10" /></FilterField>
          <FilterField label="Zieltermin bis"><CustomDatePicker aria-label="Deliverables bis Zieltermin filtern" value={filters.to} onChange={(to) => updateFilters({ to })} className="h-10" /></FilterField>
        </div>
      </FilterToolbar>
      <UiPanel>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aktives Projekt</div>
        <h2 className="mt-1 text-lg font-semibold text-slate-950">{data.project.name}</h2>
        <p className="mt-1 text-sm text-slate-500">Struktur: Epic → Initiative → Deliverable → Sub-Issue. Sprints sind der Zeitcontainer für Deliverables.</p>
      </UiPanel>
      <section className="grid gap-3 lg:grid-cols-2">
        <UiPanel>
          <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Nicht freigegebene Initiativen</div>
          <div className="mt-3 grid gap-2">
            {pendingInitiatives.map((initiative) => {
              const canDecide = canDecideInitiativeApproval(initiative, currentProfile);
              const canReturn = canReturnInitiativeForRevision(initiative, currentProfile);
              const canWithdraw = canWithdrawPlanningRoot({
                rootType: "initiative",
                approvalStatus: initiative.approvalStatus,
                proposedById: initiative.proposedById,
              }, currentProfile, false);
              return (
                <div key={initiative.id} className="rounded-md border border-slate-200 p-3">
                  <div className="font-semibold text-slate-950">{initiative.title}</div>
                  <div className="mt-1 text-xs text-slate-500">{initiative.approvalStatus === "draft" ? "Entwurf" : "Eingereicht"} · Revision {initiative.approvalRevision} · Antrag: {profileName(initiative.proposedById)}</div>
                  {(canDecide || canReturn || canWithdraw) && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {canDecide && <UiButton size="xs" variant="primary" disabled={pending} onClick={() => onDecideInitiative(initiative, "approve")}>Freigeben</UiButton>}
                      {canDecide && <UiButton size="xs" disabled={pending} onClick={() => setApprovalDecision({ initiative, action: "reject" })}>Ablehnen</UiButton>}
                      {canReturn && <UiButton size="xs" disabled={pending} onClick={() => setApprovalDecision({ initiative, action: "return_to_draft" })}>Zur Überarbeitung</UiButton>}
                      {canWithdraw && <UiButton size="xs" variant="red" disabled={pending} onClick={() => setWithdrawal(initiative)}>Zurückziehen</UiButton>}
                    </div>
                  )}
                </div>
              );
            })}
            {!pendingInitiatives.length && <p className="text-sm text-slate-500">Keine Initiative wartet auf Freigabe.</p>}
          </div>
        </UiPanel>
        <UiPanel>
          <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Proposed Deliverables</div>
          <div className="mt-3 grid gap-2">
            {proposedDeliverables.map((task) => (
              <button key={task.id} type="button" onClick={() => onOpenTask(task.id)} className="rounded-md border border-slate-200 p-3 text-left hover:bg-slate-50">
                <span className="block font-semibold text-slate-950">{task.title}</span>
                <span className="mt-1 block text-xs text-slate-500">Revision {task.approvalRevision} · {initiatives.find((initiative) => initiative.id === task.parentTaskId)?.title || "Ohne Initiative"}</span>
              </button>
            ))}
            {!proposedDeliverables.length && <p className="text-sm text-slate-500">Kein Deliverable wartet auf Freigabe.</p>}
          </div>
        </UiPanel>
      </section>
      <section className="grid gap-3">
        {filterViewModel.hierarchy.map(({ epic, initiatives: groups, tasks: epicTasks }) => {
          const epicKey = epic?.id || "without-epic";
          const isEpicOpen = filtersActive || openEpicIds.has(epicKey);
          const blocked = epicTasks.filter((task) => task.dependsOn || normalizeStatus(task.status) === "Blockiert").length;
          const effort = epicTasks.reduce((sum, task) => sum + task.hours, 0);
          const contentId = `epic-content-${epicKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
          const childCounts = {
            initiatives: initiatives.filter((initiative) => initiative.parentTaskId === epic?.id).length,
            tasks: epic ? tasks.filter((task) => {
              const initiative = initiatives.find((candidate) => candidate.id === task.parentTaskId);
              return initiative?.parentTaskId === epic.id;
            }).length : 0,
          };
          const statusMeta = epicStatusMeta(epic?.status || "Offen");

          return (
            <UiPanel key={epicKey} as="article" padding="none" className="overflow-hidden">
              <div className="flex items-start border-b border-transparent">
                <button
                  type="button"
                  onClick={() => setOpenEpicIds((current) => toggleSetValue(current, epicKey))}
                  className="flex min-w-0 flex-1 flex-col gap-4 px-4 py-4 text-left hover:bg-slate-50 sm:flex-row sm:items-start sm:justify-between"
                  aria-expanded={isEpicOpen}
                  aria-controls={contentId}
                >
                  <span className="flex min-w-0 gap-3">
                    <span className="mt-1 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500">
                      {isEpicOpen ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
                    </span>
                    <span className="min-w-0">
                      <span className="text-xs font-semibold uppercase tracking-wide text-blue-700">Epic</span>
                      <span className="mt-1 block truncate text-base font-semibold text-slate-950">{epic?.title || "Ohne Epic"}</span>
                      <span className="mt-1 block text-sm leading-6 text-slate-600">{epic?.description || "Initiativen ohne zugeordnetes Epic."}</span>
                      <span className="mt-2 flex flex-wrap items-center gap-2">
                        <UiBadge size="xs" tone={statusMeta.tone}>{statusMeta.label}</UiBadge>
                        <span className="text-xs font-medium text-slate-500">
                          Zieltermin: {epic?.targetDate ? formatDate(epic.targetDate) : "nicht gesetzt"}
                        </span>
                      </span>
                    </span>
                  </span>
                  <span className="grid w-full shrink-0 grid-cols-2 gap-3 text-left text-xs text-slate-500 sm:w-auto sm:grid-cols-4 sm:text-right">
                    <span><span className="block font-semibold text-slate-900">{groups.length}</span> Initiativen</span>
                    <span><span className="block font-semibold text-slate-900">{epicTasks.length}</span> Deliverables</span>
                    <span><span className="block font-semibold text-slate-900">{blocked}</span> Blockiert</span>
                    <span><span className="block font-semibold text-slate-900">{effort}h</span> Aufwand</span>
                  </span>
                </button>
                {epic && canManageEpics && (
                  <div className="shrink-0 px-3 py-4">
                    <CustomActionMenu
                      label={`Aktionen für ${epic.title}`}
                      triggerAriaLabel={`Aktionen für Epic ${epic.title}`}
                      groups={[{
                        id: "epic-actions",
                        items: [
                          { id: "edit", label: "Bearbeiten", icon: <Pencil size={15} aria-hidden="true" />, onSelect: () => onEditEpic(epic) },
                          { id: "delete", label: "Löschen", tone: "danger", icon: <Trash2 size={15} aria-hidden="true" />, onSelect: () => onDeleteEpic(epic, childCounts) },
                        ],
                      }]}
                    />
                  </div>
                )}
              </div>
              {isEpicOpen && (
                <div id={contentId} className="grid gap-3 border-t border-slate-100 bg-slate-50 p-3">
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
            {filterViewModel.totalCount ? (
              "Keine Epics, Initiativen oder Deliverables für diese Filter."
            ) : (
              <span className="grid justify-items-center gap-3">
                <span>Noch keine Epics vorhanden.</span>
                {canManageEpics && <UiButton variant="primary" onClick={onCreateEpic}>Erstes Epic anlegen</UiButton>}
              </span>
            )}
          </UiEmptyState>
        )}
      </section>
      {approvalDecision && (
        <ApprovalDecisionDialog
          action={approvalDecision.action}
          entityLabel="Initiative"
          pending={pending}
          onClose={() => setApprovalDecision(null)}
          onConfirm={(note) => {
            const { initiative, action } = approvalDecision;
            setApprovalDecision(null);
            onDecideInitiative(initiative, action, note);
          }}
        />
      )}
      {withdrawal && (
        <PlanningTrashActionDialog
          action="withdraw"
          entityLabel="Initiative"
          itemTitle={withdrawal.title}
          pending={pending}
          onClose={() => setWithdrawal(null)}
          onConfirm={(reason) => {
            const initiative = withdrawal;
            setWithdrawal(null);
            onWithdrawInitiative(initiative, reason);
          }}
        />
      )}
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
  data: PlanningShellState;
  initiative: Task;
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
      <div className="flex flex-wrap items-start justify-between gap-3 p-3">
        <button type="button" onClick={onToggle} className="flex min-w-0 flex-1 gap-2 text-left" aria-expanded={isOpen}>
          <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-slate-200 bg-slate-50 text-slate-500">
            {isOpen ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}
          </span>
          <span className="min-w-0">
            <span className="text-xs font-semibold text-blue-700">{initiativeMetaLabel(initiative)}</span>
            <span className="ml-2 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-800">{initiative.approvalStatus}</span>
            <span className="mt-1 block truncate text-sm font-semibold text-slate-950">{initiative.title}</span>
            <span className="mt-1 block text-xs text-slate-500">Owner: {profileName(initiative.ownerId)}{initiative.targetDate ? ` · Zieltermin: ${formatDate(initiative.targetDate)}` : ""}</span>
            <span className="mt-2 block text-sm leading-6 text-slate-600">{initiative.strategy?.goal || initiative.description}</span>
          </span>
        </button>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:flex-nowrap">
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
              {initiative.strategy?.successCriteria && (
                <p className="text-xs leading-5 text-slate-500"><span className="font-semibold text-slate-700">Erfolgskriterien:</span> {initiative.strategy.successCriteria}</p>
              )}
              {initiative.strategy?.scopeConstraints && (
                <p className="text-xs leading-5 text-slate-500"><span className="font-semibold text-slate-700">Constraints:</span> {initiative.strategy.scopeConstraints}</p>
              )}
              <div className="grid grid-cols-3 gap-2 text-sm">
                <div className="rounded-md bg-slate-50 p-2"><div className="text-xs text-slate-500">Erledigt</div><div className="font-semibold text-slate-900">{done}</div></div>
                <div className="rounded-md bg-slate-50 p-2"><div className="text-xs text-slate-500">Blockiert</div><div className="font-semibold text-slate-900">{blocked}</div></div>
                <div className="rounded-md bg-slate-50 p-2"><div className="text-xs text-slate-500">Aufwand</div><div className="font-semibold text-slate-900">{effort}h</div></div>
              </div>
            </div>
            <DeliverableTable tasks={tasks} sprints={data.sprints} totalCount={data.tasks.filter((task) => task.parentTaskId === initiative.id && task.taskType === "deliverable").length} onOpenTask={onOpenTask} filters={filters} onFiltersChange={onFiltersChange} ownerOptions={ownerOptions} statusOptions={statusOptions} priorityOptions={priorityOptions} />
          </div>
        </div>
      )}
    </div>
  );
}

function DeliverableTable({
  tasks,
  sprints,
  totalCount,
  onOpenTask,
  filters,
  onFiltersChange,
  ownerOptions,
  statusOptions,
  priorityOptions,
}: {
  tasks: Task[];
  sprints: Sprint[];
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
    <DataTableFrame
      title="Deliverables"
      caption="Deliverables der Initiative"
      results={[{ id: "deliverables", visibleCount: tasks.length, totalCount }]}
      filtering={{ mode: "external", labelledBy: "project-data-filters" }}
      minWidth={760}
      mobileContentBreakpoint="xl"
      mobileContent={(
        <div className="grid divide-y divide-slate-200 bg-white md:grid-cols-2 md:gap-3 md:divide-y-0 md:bg-slate-50 md:p-3">
          {tasks.map((task) => {
            const schedule = projectDeliverableSchedule({ sprintId: task.sprintId || null, fixedDate: task.fixedDate || null }, sprints);
            return <article key={task.id} className="grid gap-3 px-4 py-4 md:rounded-md md:border md:border-slate-200 md:bg-white">
              <TaskReferenceLink task={task} onOpenTask={onOpenTask} layout="flex" className="min-h-11 items-start py-1 font-semibold leading-5 text-slate-950">
                <span className="line-clamp-2">{task.title}</span>
              </TaskReferenceLink>
              <div className="flex flex-wrap gap-2">
                <UiBadge tone={priorityBadgeTone(task.priority)}>{task.priority}</UiBadge>
                <UiBadge tone="white">{task.approvalStatus === "approved" ? normalizeStatus(task.status) : task.approvalStatus}</UiBadge>
              </div>
              <dl className="grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                <div><dt className="font-semibold text-slate-500">Owner</dt><dd>{taskAssigneeLabel(task)}</dd></div>
                <div><dt className="font-semibold text-slate-500">Aufwand</dt><dd>{task.hours}h</dd></div>
                <div><dt className="font-semibold text-slate-500">Sprint-Zeitraum</dt><dd>{schedule.sprint ? dateRange(schedule.sprint) : "–"}</dd></div>
                <div><dt className="font-semibold text-slate-500">Fixtermin</dt><dd>{schedule.fixedDate || "–"}</dd></div>
              </dl>
            </article>;
          })}
          {!tasks.length && <UiEmptyState className="m-4 md:col-span-2">{totalCount ? "Keine Deliverables für diese Filter." : "Noch keine Deliverables in dieser Initiative."}</UiEmptyState>}
        </div>
      )}
    >
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
      {tasks.map((task) => {
        const schedule = projectDeliverableSchedule({ sprintId: task.sprintId || null, fixedDate: task.fixedDate || null }, sprints);
        return <DataRow key={task.id}>
          <DataCell className="min-w-0" sticky>
            <TaskReferenceLink task={task} onOpenTask={onOpenTask} className="max-w-full font-semibold text-slate-950">
              <span className="block truncate">{task.title}</span>
            </TaskReferenceLink>
            <span className="mt-0.5 block text-xs text-slate-500">{task.priority} · {task.workstream || "ohne Bereich"}</span>
          </DataCell>
          <DataCell className="truncate text-slate-700">{taskAssigneeLabel(task)}</DataCell>
          <DataCell className="text-slate-700">{task.approvalStatus === "approved" ? normalizeStatus(task.status) : task.approvalStatus}</DataCell>
          <DataCell className="text-slate-700">{task.hours}h</DataCell>
          <DataCell className="truncate text-slate-700">{schedule.sprint ? dateRange(schedule.sprint) : "–"}{schedule.fixedDate ? ` · Fixtermin ${schedule.fixedDate}` : ""}</DataCell>
        </DataRow>;
      })}
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
