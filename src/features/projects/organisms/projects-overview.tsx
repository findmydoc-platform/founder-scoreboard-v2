"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { InitiativeRaciList } from "@/features/projects/molecules/initiative-raci-list";
import { TaskReferenceLink } from "@/features/tasks/atoms/task-reference-link";
import { dateRange, formatDate, initiativeMetaLabel, taskAssigneeLabel } from "@/lib/display";
import { normalizeStatus } from "@/lib/status";
import type { Package, PlanningData, Profile, Task } from "@/lib/types";
import { UiBadge, UiButton, UiEmptyState, UiPanel } from "@/shared/atoms/ui-primitives";

export function ProjectsOverview({
  data,
  tasks,
  currentProfile,
  canManageInitiatives,
  onEditInitiative,
  onOpenTask,
}: {
  data: PlanningData;
  tasks: Task[];
  currentProfile?: Profile | null;
  canManageInitiatives: boolean;
  onEditInitiative: (initiative: Package) => void;
  onOpenTask: (taskId: string) => void;
}) {
  const milestones = data.milestones.length
    ? data.milestones
    : [{ id: "", title: "Ohne Epic", description: "Initiativen ohne zugeordneten Meilenstein.", targetDate: "", status: "planned" as const, sortOrder: 999 }];
  const [openMilestoneIds, setOpenMilestoneIds] = useState<Set<string>>(new Set());
  const [openInitiativeIds, setOpenInitiativeIds] = useState<Set<string>>(new Set());
  const profileName = (profileId?: string) => data.profiles.find((profile) => profile.id === profileId)?.name || "Nicht gesetzt";

  return (
    <div className="grid gap-4">
      <UiPanel>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aktives Projekt</div>
        <h2 className="mt-1 text-lg font-semibold text-slate-950">{data.project.name}</h2>
        <p className="mt-1 text-sm text-slate-500">Struktur: Epic / Meilenstein → Initiative → Deliverable → Sub-Issue. Sprints sind der Zeitcontainer für Deliverables.</p>
      </UiPanel>
      <section className="grid gap-3">
        {milestones.map((milestone) => {
          const milestoneKey = milestone.id || "without-epic";
          const groups = data.packages.filter((pack) => (milestone.id ? pack.milestoneId === milestone.id : !pack.milestoneId));
          const milestoneTasks = tasks.filter((task) => groups.some((pack) => pack.id === task.packageId));
          const isMilestoneOpen = openMilestoneIds.has(milestoneKey);
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
                  {groups.map((pack) => (
                    <InitiativeTreeItem
                      key={pack.id}
                      data={data}
                      initiative={pack}
                      tasks={tasks.filter((task) => task.packageId === pack.id && task.taskType !== "sub_issue")}
                      profileName={profileName}
                      isOpen={openInitiativeIds.has(pack.id)}
                      canEdit={canManageInitiatives || pack.ownerId === currentProfile?.id}
                      onToggle={() => setOpenInitiativeIds((current) => toggleSetValue(current, pack.id))}
                      onEdit={() => onEditInitiative(pack)}
                      onOpenTask={onOpenTask}
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
            <DeliverableTable tasks={tasks} onOpenTask={onOpenTask} />
          </div>
        </div>
      )}
    </div>
  );
}

function DeliverableTable({ tasks, onOpenTask }: { tasks: Task[]; onOpenTask: (taskId: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-md border border-slate-200">
      <div className="grid min-w-[760px] grid-cols-[minmax(220px,1fr)_120px_110px_90px_120px] gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase text-slate-500">
        <span>Deliverable</span>
        <span>Owner</span>
        <span>Status</span>
        <span>Aufwand</span>
        <span>Zeitraum</span>
      </div>
      {tasks.map((task) => (
        <div key={task.id} className="grid min-w-[760px] grid-cols-[minmax(220px,1fr)_120px_110px_90px_120px] gap-2 border-b border-slate-100 px-3 py-2 text-sm last:border-b-0 hover:bg-slate-50">
          <span className="min-w-0">
            <TaskReferenceLink task={task} onOpenTask={onOpenTask} className="max-w-full font-semibold text-slate-950">
              <span className="block truncate">{task.title}</span>
            </TaskReferenceLink>
            <span className="mt-0.5 block text-xs text-slate-500">{task.priority} · {task.workstream || "ohne Bereich"}</span>
          </span>
          <span className="truncate text-slate-700">{taskAssigneeLabel(task)}</span>
          <span className="text-slate-700">{normalizeStatus(task.status)}</span>
          <span className="text-slate-700">{task.hours}h</span>
          <span className="truncate text-slate-700">{dateRange(task)}</span>
        </div>
      ))}
      {!tasks.length && (
        <div className="px-3 py-5 text-center text-sm text-slate-500">Noch keine Deliverables in dieser Initiative.</div>
      )}
    </div>
  );
}

function toggleSetValue(current: Set<string>, value: string) {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}
