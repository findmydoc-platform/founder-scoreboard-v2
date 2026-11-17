"use client";

import { useEffect, useRef, useState } from "react";
import type { PlanningState } from "@/features/planning/model/planning-state";
import type { PlanningStructureQuery } from "@/features/planning/model/planning-structure-query";
import type { PlanningFilterPreferences } from "@/lib/types";
import { ChevronRight } from "lucide-react";
import { TaskTypeIcon } from "@/features/tasks/atoms/task-type-indicator";
import { TaskCard } from "@/features/tasks/molecules/task-card";
import { groupSubIssuesByParent } from "@/features/tasks/model/task-card-presentation";
import { initiativeMetaLabel } from "@/lib/display";
import type { Profile, Task, TaskBlocker, TaskRelation } from "@/lib/types";
import { UiBadge, UiButton } from "@/shared/atoms/ui-primitives";
import { DataSurface } from "@/shared/molecules/data-surface";

type LegacyStructureProps = {
  initiatives: Task[];
  visibleTasks: Task[];
  relations: TaskRelation[];
  allTasks: Task[];
  blockers: TaskBlocker[];
  expandedInitiatives: Record<string, boolean>;
  assigneeProfileForTask: (task: Task) => Profile | undefined;
  onOpenTask: (taskId: string) => void;
  onToggleInitiative: (initiativeId: string) => void;
  onSetAllInitiativeCollapse: (collapsed: boolean) => void;
};

function LegacyTaskStructureView({
  initiatives,
  visibleTasks,
  relations,
  allTasks,
  blockers,
  expandedInitiatives,
  assigneeProfileForTask,
  onOpenTask,
  onToggleInitiative,
  onSetAllInitiativeCollapse,
}: LegacyStructureProps) {
  const subIssuesByParent = groupSubIssuesByParent(allTasks);

  return (
    <div className="grid gap-4">
      <div className="flex justify-end gap-2">
        <UiButton type="button" onClick={() => onSetAllInitiativeCollapse(true)} size="sm">
          Alle einklappen
        </UiButton>
        <UiButton type="button" onClick={() => onSetAllInitiativeCollapse(false)} size="sm">
          Alle ausklappen
        </UiButton>
      </div>
      {initiatives.map((initiative) => {
        const tasks = visibleTasks.filter((task) => task.parentTaskId === initiative.id);
        const expanded = Boolean(expandedInitiatives[initiative.id]);
        return (
          <DataSurface key={initiative.id}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
              <button type="button" onClick={() => onToggleInitiative(initiative.id)} className="flex min-w-0 flex-1 items-start gap-3 rounded-md text-left outline-none focus:ring-2 focus:ring-blue-100" aria-expanded={expanded}>
                <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-slate-500">
                  <ChevronRight size={16} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-blue-700">
                    <TaskTypeIcon taskType={initiative.taskType} size={14} />
                    <span>{initiativeMetaLabel(initiative)}</span>
                  </span>
                  <span className="mt-0.5 block text-base font-semibold text-slate-950">{initiative.title}</span>
                  <span className="mt-1 block text-sm text-slate-500">{initiative.strategy?.goal || initiative.description}</span>
                </span>
              </button>
              <UiBadge tone="white" size="md">{tasks.length} Aufgaben</UiBadge>
            </div>
            {expanded && (
              <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                {tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    assigneeProfile={assigneeProfileForTask(task)}
                    relations={relations}
                    allTasks={allTasks}
                    blockers={blockers}
                    subIssues={subIssuesByParent.get(task.id) || []}
                    onOpenTask={onOpenTask}
                  />
                ))}
              </div>
            )}
          </DataSurface>
        );
      })}
    </div>
  );
}


type SelectedStructureProps = LegacyStructureProps & { readMode: "selected"; planningState: PlanningState; filters: PlanningFilterPreferences };
export function TaskStructureView(props: LegacyStructureProps | SelectedStructureProps) {
  return "readMode" in props && props.readMode === "selected" ? <SelectedTaskStructureView {...props} /> : <LegacyTaskStructureView {...props} />;
}
const rootQuery: PlanningStructureQuery = { view: "structure", area: "roots", limit: 20 };
function SelectedTaskStructureView(props: SelectedStructureProps) {
  const state = props.planningState;
  const roots = state.structure(rootQuery);
  useEffect(() => { const release = state.activateStructure(rootQuery), controller = new AbortController(); void state.loadStructure(rootQuery, { signal: controller.signal }); return () => { controller.abort(); release(); }; }, [state]);
  return <div className="grid gap-4">
    <div className="flex justify-end gap-2"><UiButton type="button" size="sm" onClick={() => props.onSetAllInitiativeCollapse(true)}>Alle einklappen</UiButton><UiButton type="button" size="sm" onClick={() => props.onSetAllInitiativeCollapse(false)}>Alle ausklappen</UiButton></div>
    {roots.readStatus === "loading" || roots.readStatus === "not-loaded" ? <p>Initiativen werden geladen.</p> : null}
    {roots.readStatus === "unavailable" || roots.readStatus === "stale" ? <UiButton type="button" onClick={() => void state.loadStructure(rootQuery, { refresh: true })}>Initiativen erneut laden</UiButton> : null}
    {roots.selection?.itemIds.map(id => { const task = state.taskDetail(id).task; return task ? <SelectedStructureGroup key={id} {...props} initiative={task} /> : null; })}
    {roots.selection?.continuation ? <UiButton type="button" onClick={() => void state.loadStructure({ ...rootQuery, continuation: roots.selection!.continuation! }, { append: true })}>Weitere Initiativen laden</UiButton> : null}
  </div>;
}
function SelectedStructureGroup(props: SelectedStructureProps & { initiative: Task }) {
  const { planningState: state, initiative } = props;
  const expanded = Boolean(props.expandedInitiatives[initiative.id]);
  const query: PlanningStructureQuery = { view: "structure", area: "children", parentId: initiative.id, filters: { ...props.filters, sort: "priority", direction: "asc" }, limit: 20 };
  const signature = JSON.stringify(query);
  const [loadingMore, setLoadingMore] = useState(false);
  const lease = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!expanded) return;
    const release = state.activateStructure(JSON.parse(signature) as PlanningStructureQuery);
    const controller = new AbortController(); lease.current = controller;
    void state.loadStructure(JSON.parse(signature) as PlanningStructureQuery, { signal: controller.signal });
    return () => { lease.current?.abort(); lease.current = null; release(); };
  }, [state, expanded, signature]);
  const read = state.structure(query);
  return <DataSurface>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
      <button type="button" onClick={() => props.onToggleInitiative(initiative.id)} aria-expanded={expanded} className="flex min-w-0 flex-1 items-start gap-3 rounded-md text-left outline-none focus:ring-2 focus:ring-blue-100">
        <ChevronRight size={16} className={expanded ? "rotate-90" : ""} /><span><span className="block font-semibold">{initiative.title}</span><span className="block text-sm text-slate-600">{initiative.strategy?.goal || initiative.description}</span></span>
      </button><UiBadge tone="white">{read.selection ? `${read.selection.total} Aufgaben` : "Aufgaben noch nicht geladen"}</UiBadge>
    </div>
    {expanded ? <div className="grid gap-3 p-4">
      {read.readStatus === "loading" || read.readStatus === "not-loaded" ? <p>Aufgaben werden geladen.</p> : null}
      {read.readStatus === "unavailable" || read.readStatus === "stale" ? <><p>Aufgaben konnten nicht geladen werden.</p><UiButton type="button" onClick={() => { lease.current?.abort(); const controller = new AbortController(); lease.current = controller; void state.loadStructure(query, { refresh: true, signal: controller.signal }); }}>Aufgaben erneut laden</UiButton></> : null}
      {read.readStatus === "forbidden" ? <p>Aufgaben sind nicht verfügbar.</p> : null}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{read.selection?.itemIds.map(id => { const task = state.taskDetail(id).task; return task ? <TaskCard key={id} task={task} assigneeProfile={props.assigneeProfileForTask(task)} relations={props.relations} allTasks={props.allTasks} blockers={props.blockers} onOpenTask={props.onOpenTask} /> : null; })}</div>
      {read.selection?.continuation ? <UiButton type="button" disabled={loadingMore} onClick={() => { lease.current?.abort(); const controller = new AbortController(); lease.current = controller; setLoadingMore(true); void state.loadStructure({ ...query, continuation: read.selection!.continuation! }, { append: true, signal: controller.signal }).finally(() => { if (!controller.signal.aborted) setLoadingMore(false); }); }}>Weitere Deliverables laden</UiButton> : null}
    </div> : null}
  </DataSurface>;
}
