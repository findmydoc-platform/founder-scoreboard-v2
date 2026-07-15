"use client";

import { CalendarDays, ChevronDown, Pencil, UsersRound } from "lucide-react";
import { useState, type ReactNode } from "react";
import { isApprovedDeliverable } from "@/features/planning/model/approval-domain";
import { InitiativeRaciList } from "@/features/projects/molecules/initiative-raci-list";
import {
  initiativeOptions,
  milestoneOptions,
  parentDeliverableOptions,
  sprintOptions,
} from "@/features/tasks/model/task-form-options";
import { compactDateRange } from "@/lib/display";
import type { Milestone, Package, Profile, Sprint, Task } from "@/lib/types";
import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { UiSelectField } from "@/shared/atoms/form-controls";
import { classNames, UiButton } from "@/shared/atoms/ui-primitives";

type Props = {
  task: Task;
  pack?: Package;
  teamProfiles: Profile[];
  packages: Package[];
  parentDeliverables: Task[];
  sprints: Sprint[];
  milestones: Milestone[];
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
  pack,
  teamProfiles,
  packages,
  parentDeliverables,
  sprints,
  milestones,
  canManageTaskMeta,
  canReparentSubIssue,
  pending,
  onUpdate,
}: Props) {
  const [open, setOpen] = useState(false);
  const currentPackage = packages.find((item) => item.id === task.packageId) || pack;
  const currentParent = parentDeliverables.find((item) => item.id === task.parentTaskId);
  const currentSprint = sprints.find((item) => item.id === task.sprintId);
  const currentMilestone = milestones.find((item) => item.id === task.milestoneId);
  const dateSource = task.startDate || task.endDate || task.deadline
    ? task
    : { startDate: currentSprint?.startDate || "", endDate: currentSprint?.endDate || "", deadline: "" };
  const canEditPlanning = task.taskType === "sub_issue" ? canReparentSubIssue : canManageTaskMeta;

  const updatePackage = (packageId: string) => {
    const nextPackage = packages.find((item) => item.id === packageId);
    onUpdate({ packageId, milestoneId: nextPackage?.milestoneId || task.milestoneId });
  };
  const updateMilestone = (milestoneId: string) => {
    const nextPackage = packages.find((item) => !milestoneId || !item.milestoneId || item.milestoneId === milestoneId);
    onUpdate({ milestoneId, packageId: nextPackage?.id || task.packageId });
  };
  const updateParentDeliverable = (parentTaskId: string) => {
    const parent = parentDeliverables.find((item) => item.id === parentTaskId);
    onUpdate({
      parentTaskId,
      packageId: parent?.packageId || "",
      milestoneId: parent?.milestoneId || "",
      parentApprovalStatus: parent?.approvalStatus || null,
    });
  };

  return (
    <section aria-label="Planung" className="border-b border-slate-200">
      <div className="flex min-h-14 flex-wrap items-center justify-between gap-3 py-2.5">
        <div className="flex min-w-0 items-center gap-3 text-sm">
          <CalendarDays size={17} className="shrink-0 text-slate-400" aria-hidden="true" />
          <span className="truncate font-semibold text-slate-900">
            {currentSprint?.name || "Kein Sprint"}
          </span>
          <span className="text-slate-300" aria-hidden="true">·</span>
          <span className="whitespace-nowrap text-slate-600">{compactDateRange(dateSource)}</span>
        </div>
        <UiButton
          type="button"
          size="sm"
          variant="ghost"
          className="text-blue-700 hover:bg-blue-50"
          aria-expanded={open}
          aria-controls="task-detail-planning-controls"
          onClick={() => setOpen((current) => !current)}
        >
          <Pencil size={14} aria-hidden="true" />
          {canEditPlanning ? "Planung bearbeiten" : "Planung anzeigen"}
          <ChevronDown size={15} className={classNames("transition", open && "rotate-180")} aria-hidden="true" />
        </UiButton>
      </div>

      {open ? (
        <div id="task-detail-planning-controls" className="border-t border-slate-200 bg-slate-50/70 px-4 py-4">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {task.taskType === "sub_issue" ? (
              <>
                {canReparentSubIssue ? (
                  <UiSelectField
                    label="Parent-Deliverable"
                    value={task.parentTaskId}
                    disabled={pending}
                    onChange={updateParentDeliverable}
                    options={parentDeliverableOptions(parentDeliverables, packages)}
                    selectClassName="h-11 text-sm"
                  />
                ) : <ReadFact label="Parent-Deliverable">{currentParent?.title || task.parentTaskId || "Nicht gesetzt"}</ReadFact>}
                <ReadFact label="Geerbte Initiative">{currentPackage?.title || "Ohne Initiative"}</ReadFact>
                <ReadFact label="Geerbtes Epic / Meilenstein">{currentMilestone?.title || "Kein Epic"}</ReadFact>
              </>
            ) : canManageTaskMeta ? (
              <>
                <UiSelectField label="Initiative" value={task.packageId} disabled={pending} onChange={updatePackage} options={initiativeOptions(packages)} selectClassName="h-11 text-sm" />
                <UiSelectField label="Sprint" value={task.sprintId} disabled={!isApprovedDeliverable(task) || pending} onChange={(sprintId) => onUpdate({ sprintId })} options={sprintOptions(sprints)} selectClassName="h-11 text-sm" />
                <UiSelectField label="Epic / Meilenstein" value={task.milestoneId || ""} disabled={pending} onChange={updateMilestone} options={milestoneOptions(milestones, "Kein Epic")} selectClassName="h-11 text-sm" />
              </>
            ) : (
              <>
                <ReadFact label="Initiative">{currentPackage?.title || "Ohne Initiative"}</ReadFact>
                <ReadFact label="Sprint">{currentSprint?.name || "Kein Sprint"}</ReadFact>
                <ReadFact label="Epic / Meilenstein">{currentMilestone?.title || "Kein Epic"}</ReadFact>
              </>
            )}

            {canManageTaskMeta ? (
              <div>
                <div className="text-xs font-semibold text-slate-500">Zeitraum</div>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <CustomDatePicker value={task.startDate || ""} disabled={pending} onChange={(startDate) => onUpdate({ startDate })} className="h-11 text-sm" aria-label="Startdatum ändern" />
                  <CustomDatePicker value={task.endDate || ""} disabled={pending} onChange={(endDate) => onUpdate({ endDate })} className="h-11 text-sm" aria-label="Enddatum ändern" />
                </div>
              </div>
            ) : null}
          </div>

          {task.taskType === "sub_issue" && task.parentApprovalStatus !== "approved" ? (
            <p className="mt-4 text-xs font-medium text-amber-800">Unter einem nicht freigegebenen Deliverable bleibt dieses Sub-Issue inaktiv.</p>
          ) : null}

          {currentPackage ? (
            <details className="group mt-4 w-fit">
              <summary className="flex min-h-9 cursor-pointer list-none items-center gap-2 rounded-md px-2 text-xs font-semibold text-slate-600 hover:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
                <UsersRound size={15} aria-hidden="true" />
                Initiative-Team anzeigen
                <ChevronDown size={14} className="transition group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="mt-2 w-72 rounded-lg border border-slate-200 bg-white p-3">
                <InitiativeRaciList initiative={currentPackage} profiles={teamProfiles} className="grid gap-2 text-xs text-slate-600" />
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
