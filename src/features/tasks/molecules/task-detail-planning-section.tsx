"use client";

import { CalendarDays, ChevronDown, ListTree, Pencil, UsersRound } from "lucide-react";
import { useState, type ReactNode } from "react";
import { isApprovedDeliverable } from "@/features/planning/model/approval-domain";
import { InitiativeRaciList } from "@/features/projects/molecules/initiative-raci-list";
import { parentDeliverableOptions, sprintOptions } from "@/features/tasks/model/task-form-options";
import { compactDateRange } from "@/lib/display";
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
  const currentParent = allTasks.find((item) => item.id === task.parentTaskId) || null;
  const currentSprint = sprints.find((item) => item.id === task.sprintId);
  const initiatives = allTasks.filter((item) => item.taskType === "initiative");
  const epics = allTasks.filter((item) => item.taskType === "epic");
  const isStrategic = task.taskType === "epic" || task.taskType === "initiative";
  const currentInitiative = initiatives.find((item) => item.id === task.parentTaskId);
  const targetDate = task.targetDate || task.deadline || "";
  const canEditPlanning = task.taskType === "sub_issue" ? canReparentSubIssue : canManageTaskMeta;
  const dateSource = task.startDate || task.endDate || task.deadline
    ? task
    : { startDate: currentSprint?.startDate || "", endDate: currentSprint?.endDate || "", deadline: "" };

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
              <div className="truncate text-sm font-semibold text-slate-900">{currentParent?.title || task.parentTaskId || "Parent-Deliverable fehlt"}</div>
              <div className="mt-0.5 truncate text-xs text-slate-500">{currentInitiative?.title || "Ohne Initiative"}</div>
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

  if (isStrategic) {
    const parentOptions = task.taskType === "initiative"
      ? [{ value: "", label: "Ohne Epic – als Vorschlag" }, ...epics.map((item) => ({ value: item.id, label: item.title }))]
      : [];
    return (
      <section aria-label="Strategische Einordnung" className="border-b border-slate-200">
        <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 py-2.5">
          <div className="flex min-w-0 items-center gap-3 text-sm">
            <CalendarDays size={17} className="shrink-0 text-slate-400" aria-hidden="true" />
            <span className="truncate font-semibold text-slate-900">{targetDate || "Kein Zieltermin"}</span>
            {task.taskType === "initiative" ? <><span className="text-slate-300" aria-hidden="true">·</span><span className="truncate text-slate-600">{currentParent?.title || "Ohne Epic"}</span></> : null}
          </div>
          <UiButton type="button" size="sm" variant="ghost" className="text-blue-700 hover:bg-blue-50" aria-expanded={open} aria-controls="strategic-planning-controls" onClick={() => setOpen((current) => !current)}>
            <Pencil size={14} aria-hidden="true" />
            {canEditPlanning ? "Einordnung bearbeiten" : "Einordnung anzeigen"}
            <ChevronDown size={15} className={classNames("transition", open && "rotate-180")} aria-hidden="true" />
          </UiButton>
        </div>
        {open ? (
          <div id="strategic-planning-controls" className="grid gap-4 border-t border-slate-200 bg-slate-50/70 px-4 py-4 md:grid-cols-2">
            {task.taskType === "initiative" ? (
              canEditPlanning
                ? <UiSelectField label="Parent-Epic" value={task.parentTaskId} disabled={pending} onChange={updateParent} options={parentOptions} selectClassName="h-11 text-sm" />
                : <ReadFact label="Parent-Epic">{currentParent?.title || "Ohne Epic"}</ReadFact>
            ) : null}
            {canEditPlanning ? (
              <div><div className="text-xs font-semibold text-slate-500">Zieltermin</div><CustomDatePicker value={targetDate} disabled={pending} onChange={(targetDateValue) => onUpdate({ targetDate: targetDateValue })} className="mt-1 h-11 text-sm" aria-label="Zieltermin ändern" /></div>
            ) : <ReadFact label="Zieltermin">{targetDate || "Nicht gesetzt"}</ReadFact>}
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
          <span className="truncate font-semibold text-slate-900">{currentSprint?.name || "Kein Sprint"}</span>
          <span className="text-slate-300" aria-hidden="true">·</span>
          <span className="whitespace-nowrap text-slate-600">{compactDateRange(dateSource)}</span>
          <span className="text-slate-300" aria-hidden="true">·</span>
          <span className="truncate text-slate-600">{currentParent?.title || "Ohne Initiative"}</span>
        </div>
        <UiButton type="button" size="sm" variant="ghost" className="text-blue-700 hover:bg-blue-50" aria-expanded={open} aria-controls="task-detail-planning-controls" onClick={() => setOpen((current) => !current)}>
          <Pencil size={14} aria-hidden="true" />
          {canEditPlanning ? "Planung bearbeiten" : "Planung anzeigen"}
          <ChevronDown size={15} className={classNames("transition", open && "rotate-180")} aria-hidden="true" />
        </UiButton>
      </div>
      {open ? (
        <div id="task-detail-planning-controls" className="border-t border-slate-200 bg-slate-50/70 px-4 py-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {canManageTaskMeta ? (
              <>
                <UiSelectField label="Initiative" value={task.parentTaskId} disabled={pending} onChange={updateParent} options={[{ value: "", label: "Ohne Initiative – als Vorschlag" }, ...initiatives.map((item) => ({ value: item.id, label: item.title }))]} selectClassName="h-11 text-sm" />
                <UiSelectField label="Sprint" value={task.sprintId} disabled={!isApprovedDeliverable(task) || pending} onChange={(sprintId) => onUpdate({ sprintId })} options={sprintOptions(sprints)} selectClassName="h-11 text-sm" />
                <div><div className="text-xs font-semibold text-slate-500">Zeitraum</div><div className="mt-1 grid grid-cols-2 gap-2"><CustomDatePicker value={task.startDate || ""} disabled={pending} onChange={(startDate) => onUpdate({ startDate })} className="h-11 text-sm" aria-label="Startdatum ändern" /><CustomDatePicker value={task.endDate || ""} disabled={pending} onChange={(endDate) => onUpdate({ endDate })} className="h-11 text-sm" aria-label="Enddatum ändern" /></div></div>
              </>
            ) : (
              <>
                <ReadFact label="Initiative">{currentParent?.title || "Ohne Initiative"}</ReadFact>
                <ReadFact label="Sprint">{currentSprint?.name || "Kein Sprint"}</ReadFact>
              </>
            )}
          </div>
          {currentInitiative ? (
            <details className="group mt-4 w-fit">
              <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-xs font-semibold text-slate-600 hover:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"><UsersRound size={15} aria-hidden="true" />Initiative-Team anzeigen<ChevronDown size={14} className="transition group-open:rotate-180" aria-hidden="true" /></summary>
              <div className="mt-2 w-72 rounded-lg border border-slate-200 bg-white p-3"><InitiativeRaciList initiative={currentInitiative} profiles={teamProfiles} className="grid gap-2 text-xs text-slate-600" /></div>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
