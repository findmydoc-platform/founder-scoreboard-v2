"use client";

import { CalendarDays, ChevronDown, ListTree, Pencil, UsersRound } from "lucide-react";
import { useState, type ReactNode } from "react";
import { isApprovedDeliverable } from "@/features/planning/model/approval-domain";
import { InitiativeRaciList } from "@/features/projects/molecules/initiative-raci-list";
import { parentDeliverableOptions, sprintOptions } from "@/features/tasks/model/task-form-options";
import { taskDetailPlanningView } from "@/features/tasks/model/task-detail-planning-view";
import type { Profile, Sprint, Task } from "@/lib/types";
import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { UiSelectField } from "@/shared/atoms/form-controls";
import { classNames, UiButton } from "@/shared/atoms/ui-primitives";

type Props = {
  task: Task;
  teamProfiles: Profile[];
  allTasks: Task[];
  sprints: Sprint[];
  canManageTaskMeta: boolean;
  canReparentSubIssue: boolean;
  pending: boolean;
  onUpdate: (patch: Partial<Task>) => void;
};

function ReadFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 break-words text-sm leading-6 text-slate-800">{children}</div>
    </div>
  );
}

export function TaskDetailPlanningSection({
  task,
  teamProfiles,
  allTasks,
  sprints,
  canManageTaskMeta,
  canReparentSubIssue,
  pending,
  onUpdate,
}: Props) {
  const [open, setOpen] = useState(false);
  const view = taskDetailPlanningView({
    task,
    allTasks,
    sprints,
    canManageTaskMeta,
    canReparentSubIssue,
  });

  const updateParent = (parentTaskId: string) => {
    onUpdate({ parentTaskId });
  };

  if (task.taskType === "sub_issue") {
    return (
      <section aria-label="Parent-Deliverable" className="border-b border-slate-200">
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 py-2.5">
          <div className="flex min-w-0 items-center gap-3">
            <ListTree size={17} className="shrink-0 text-slate-400" aria-hidden="true" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-900">{view.currentParent?.title || task.parentTaskId || "Parent-Deliverable fehlt"}</div>
              <div className="mt-0.5 truncate text-xs text-slate-500">{view.currentInitiative?.title || "Ohne Initiative"}</div>
            </div>
          </div>
          {canReparentSubIssue ? (
            <UiButton type="button" size="sm" variant="ghost" className="text-blue-700 hover:bg-blue-50" aria-expanded={open} aria-controls="sub-issue-parent-control" onClick={() => setOpen((current) => !current)}>
              <Pencil size={14} aria-hidden="true" />
              Parent ändern
              <ChevronDown size={15} className={classNames("transition", open && "rotate-180")} aria-hidden="true" />
            </UiButton>
          ) : null}
        </div>
        {open && canReparentSubIssue ? (
          <div id="sub-issue-parent-control" className="border-t border-slate-200 bg-slate-50/70 px-4 py-4">
            <UiSelectField label="Parent-Deliverable" value={task.parentTaskId} disabled={pending} onChange={updateParent} options={parentDeliverableOptions(allTasks)} selectClassName="h-11 text-sm" />
          </div>
        ) : null}
        {task.parentApprovalStatus !== "approved" ? <p className="pb-3 text-xs font-medium text-amber-800">Unter einem nicht freigegebenen Deliverable bleibt dieses Sub-Issue inaktiv.</p> : null}
      </section>
    );
  }

  if (view.kind === "strategic") {
    const parentOptions = task.taskType === "initiative"
      ? [{ value: "", label: "Ohne Epic – als Vorschlag" }, ...view.epics.map((item) => ({ value: item.id, label: item.title }))]
      : [];
    return (
      <section aria-label="Strategische Einordnung" className="border-b border-slate-200">
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 py-2.5">
          <div className="flex min-w-0 items-center gap-3 text-sm">
            <CalendarDays size={17} className="shrink-0 text-slate-400" aria-hidden="true" />
            <span className="truncate font-semibold text-slate-900">{view.targetDate || "Kein Zieltermin"}</span>
          </div>
          <UiButton type="button" size="sm" variant="ghost" className="text-blue-700 hover:bg-blue-50" aria-expanded={open} aria-controls="strategic-planning-controls" onClick={() => setOpen((current) => !current)}>
            <Pencil size={14} aria-hidden="true" />
            {view.canEditPlanning ? "Einordnung bearbeiten" : "Einordnung anzeigen"}
            <ChevronDown size={15} className={classNames("transition", open && "rotate-180")} aria-hidden="true" />
          </UiButton>
        </div>
        {open ? (
          <div id="strategic-planning-controls" className="grid gap-4 border-t border-slate-200 bg-slate-50/70 px-4 py-4 md:grid-cols-2">
            {task.taskType === "initiative" ? (
              view.canEditPlanning
                ? <UiSelectField label="Parent-Epic" value={task.parentTaskId} disabled={pending} onChange={updateParent} options={parentOptions} selectClassName="h-11 text-sm" />
                : <ReadFact label="Parent-Epic">{view.currentParent?.title || "Ohne Epic"}</ReadFact>
            ) : null}
            {view.canEditPlanning ? (
              <div><div className="text-xs font-semibold text-slate-500">Zieltermin</div><CustomDatePicker value={view.targetDate} disabled={pending} onChange={(targetDateValue) => onUpdate({ targetDate: targetDateValue })} className="mt-1 h-11 text-sm" aria-label="Zieltermin ändern" /></div>
            ) : <ReadFact label="Zieltermin">{view.targetDate || "Nicht gesetzt"}</ReadFact>}
            {task.taskType === "initiative" && task.raciAssignments?.length ? (
              <ReadFact label="RACI">
                {task.raciAssignments.map((assignment) => `${teamProfiles.find((profile) => profile.id === assignment.profileId)?.name || assignment.profileId} · ${assignment.role}`).join(" · ")}
              </ReadFact>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section aria-label="Planung" className="border-b border-slate-200">
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 py-2.5">
        <div className="flex min-w-0 items-center gap-3 text-sm">
          <CalendarDays size={17} className="shrink-0 text-slate-400" aria-hidden="true" />
          <span className="truncate font-semibold text-slate-900">{view.currentSprint?.name || "Kein Sprint"}</span>
          <span className="text-slate-300" aria-hidden="true">·</span>
          <span className="whitespace-nowrap text-slate-600">{view.sprintPeriod}</span>
        </div>
        <UiButton type="button" size="sm" variant="ghost" className="text-blue-700 hover:bg-blue-50" aria-expanded={open} aria-controls="task-detail-planning-controls" onClick={() => setOpen((current) => !current)}>
          <Pencil size={14} aria-hidden="true" />
          {view.canEditPlanning ? "Planung bearbeiten" : "Planung anzeigen"}
          <ChevronDown size={15} className={classNames("transition", open && "rotate-180")} aria-hidden="true" />
        </UiButton>
      </div>
      {open ? (
        <div id="task-detail-planning-controls" className="border-t border-slate-200 bg-slate-50/70 px-4 py-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {canManageTaskMeta ? (
              <>
                <UiSelectField label="Initiative" value={task.parentTaskId} disabled={pending} onChange={updateParent} options={[{ value: "", label: "Ohne Initiative – als Vorschlag" }, ...view.initiatives.map((item) => ({ value: item.id, label: item.title }))]} selectClassName="h-11 text-sm" />
                <UiSelectField label="Sprint" value={task.sprintId} disabled={!isApprovedDeliverable(task) || pending} onChange={(sprintId) => onUpdate({ sprintId })} options={sprintOptions(sprints)} selectClassName="h-11 text-sm" />
                <ReadFact label="Sprint-Zeitraum">{view.sprintPeriod}</ReadFact>
              </>
            ) : (
              <>
                <ReadFact label="Initiative">{view.currentParent?.title || "Ohne Initiative"}</ReadFact>
                <ReadFact label="Sprint">{view.currentSprint?.name || "Kein Sprint"}</ReadFact>
                <ReadFact label="Sprint-Zeitraum">{view.sprintPeriod}</ReadFact>
              </>
            )}
          </div>
          {view.currentInitiative ? (
            <details className="group mt-4 w-fit">
              <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-xs font-semibold text-slate-600 hover:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"><UsersRound size={15} aria-hidden="true" />Initiative-Team anzeigen<ChevronDown size={14} className="transition group-open:rotate-180" aria-hidden="true" /></summary>
              <div className="mt-2 w-72 rounded-lg border border-slate-200 bg-white p-3"><InitiativeRaciList initiative={view.currentInitiative} profiles={teamProfiles} className="grid gap-2 text-xs text-slate-600" /></div>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
