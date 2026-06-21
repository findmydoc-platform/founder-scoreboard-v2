"use client";

import { CalendarDays, Pencil, Save, X } from "lucide-react";
import { InitiativeRaciList } from "@/features/projects/molecules/initiative-raci-list";
import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { dateRange as formatDateRange, formatDate as formatDisplayDate, initiativeOptionLabel, taskOwnerLabel, taskOwnerOptions } from "@/lib/display";
import { reviewLabel } from "@/lib/platform";
import { normalizeStatus, taskStatuses } from "@/lib/status";
import type { Milestone, Package, Profile, Sprint, Task, TaskStatus } from "@/lib/types";
import { UiButton, UiPanel } from "@/shared/atoms/ui-primitives";

export type TaskDetailsMeta = Pick<Task, "status" | "priority" | "owner" | "packageId" | "sprintId" | "milestoneId" | "startDate" | "endDate" | "deadline" | "reviewStatus" | "reviewOwnerProfileId">;
export type TaskDetailsDraft = Pick<TaskDetailsMeta, "priority" | "owner" | "packageId" | "sprintId" | "milestoneId" | "startDate" | "endDate" | "deadline" | "reviewOwnerProfileId">;

function formatDate(value: string) {
  return formatDisplayDate(value, { includeYear: true });
}

function dateRange(task: Pick<Task, "startDate" | "endDate" | "deadline">) {
  return formatDateRange(task, { includeYear: true });
}

function availableStatusOptions(status: string, canManageTaskMeta: boolean) {
  if (canManageTaskMeta) return taskStatuses;
  if (normalizeStatus(status) === "Nacharbeit") return ["In Arbeit", "Review", "Blockiert"] as TaskStatus[];
  return taskStatuses.filter((item) => item !== "Erledigt");
}

function ownerOptionsForTask(taskType: Task["taskType"], profiles: Profile[]) {
  return taskOwnerOptions(taskType, profiles);
}

type Props = {
  task: Task;
  meta: TaskDetailsMeta;
  detailsDraft: TaskDetailsDraft;
  creatorProfile?: Profile;
  ownerProfile?: Profile;
  currentPackage?: Package;
  currentSprint?: Sprint;
  currentMilestone?: Milestone;
  canManageTaskMeta: boolean;
  canManageReviewOwner: boolean;
  detailsEditing: boolean;
  pending: boolean;
  saveState: string;
  packages: Package[];
  profiles: Profile[];
  sprints: Sprint[];
  milestones: Milestone[];
  onStatusChange: (status: TaskStatus) => void;
  onDetailsDraftChange: (patch: Partial<TaskDetailsDraft>) => void;
  onDetailsPackageChange: (packageId: string) => void;
  onDetailsMilestoneChange: (milestoneId: string) => void;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onSaveDetails: () => void;
};

export function TaskDetailsCard({
  task,
  meta,
  detailsDraft,
  creatorProfile,
  ownerProfile,
  currentPackage,
  currentSprint,
  currentMilestone,
  canManageTaskMeta,
  canManageReviewOwner,
  detailsEditing,
  pending,
  saveState,
  packages,
  profiles,
  sprints,
  milestones,
  onStatusChange,
  onDetailsDraftChange,
  onDetailsPackageChange,
  onDetailsMilestoneChange,
  onStartEditing,
  onCancelEditing,
  onSaveDetails,
}: Props) {
  const reviewOwnerProfile = profiles.find((profile) => profile.id === meta.reviewOwnerProfileId);
  const selfReview = Boolean(meta.reviewOwnerProfileId && (task.ownerId === meta.reviewOwnerProfileId || task.owner === meta.reviewOwnerProfileId));

  return (
    <UiPanel padding="lg">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-950">Details</h2>
          <span className="text-xs text-slate-500">{pending ? "Speichert..." : saveState}</span>
        </div>
        {canManageTaskMeta && (
          <div className="flex items-center gap-2">
            {detailsEditing ? (
              <>
                <button
                  type="button"
                  onClick={onCancelEditing}
                  className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50"
                  aria-label="Detailbearbeitung abbrechen"
                >
                  <X size={14} />
                </button>
                <UiButton
                  onClick={onSaveDetails}
                  variant="blue"
                  size="sm"
                >
                  <Save size={14} />
                  Speichern
                </UiButton>
              </>
            ) : (
              <UiButton
                onClick={onStartEditing}
                size="sm"
              >
                <Pencil size={14} />
                Bearbeiten
              </UiButton>
            )}
          </div>
        )}
      </div>
      <div className="mt-3 grid gap-3 text-sm">
        <label className="grid gap-1 text-xs font-semibold text-slate-500">
          Status
          <CustomSelect value={normalizeStatus(meta.status)} onChange={(value) => onStatusChange(value as TaskStatus)} className="h-9 text-sm" options={availableStatusOptions(meta.status, canManageTaskMeta).map((status) => ({ value: status, label: status }))} />
        </label>
        <div className="border-t border-slate-100 pt-3">
          <div className="text-xs font-semibold text-slate-500">Erstellt von</div>
          <div className="mt-1 text-sm font-semibold text-slate-800">{creatorProfile?.name || task.createdBy || "Unbekannt"}</div>
        </div>
        {canManageTaskMeta && detailsEditing ? (
          <>
            <label className="grid gap-1 border-t border-slate-100 pt-3 text-xs font-semibold text-slate-500">
              Assignee
              <CustomSelect value={detailsDraft.owner} onChange={(value) => onDetailsDraftChange({ owner: value })} className="h-9 text-sm" options={ownerOptionsForTask(task.taskType, profiles)} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Priorität
              <CustomSelect value={detailsDraft.priority} onChange={(value) => onDetailsDraftChange({ priority: value })} className="h-9 text-sm" options={["P0", "P1", "P2", "P3", "P4"].map((priority) => ({ value: priority, label: priority }))} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Initiative
              <CustomSelect value={detailsDraft.packageId} onChange={onDetailsPackageChange} className="h-9 text-sm" options={packages.map((item) => ({ value: item.id, label: initiativeOptionLabel(item) }))} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Sprint
              <CustomSelect value={detailsDraft.sprintId} onChange={(value) => onDetailsDraftChange({ sprintId: value })} className="h-9 text-sm" options={sprints.map((item) => ({ value: item.id, label: item.name }))} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Epic / Meilenstein
              <CustomSelect value={detailsDraft.milestoneId || ""} onChange={onDetailsMilestoneChange} className="h-9 text-sm" options={[{ value: "", label: "Kein Epic" }, ...milestones.map((item) => ({ value: item.id, label: item.title }))]} />
            </label>
          </>
        ) : (
          <>
            {[
              ["Assignee", ownerProfile?.name || taskOwnerLabel({ owner: meta.owner })],
              ["Priorität", meta.priority],
              ["Initiative", currentPackage ? currentPackage.title : "ohne Initiative"],
              ["Sprint", currentSprint?.name || "Kein Sprint"],
              ["Epic / Meilenstein", currentMilestone?.title || "Kein Epic"],
            ].map(([label, value]) => (
              <div key={label} className="border-t border-slate-100 pt-3">
                <div className="text-xs font-semibold text-slate-500">{label}</div>
                <div className="mt-1 text-sm font-semibold text-slate-800">{value}</div>
              </div>
            ))}
          </>
        )}
        <div className="border-t border-slate-100 pt-3">
          <div className="text-xs font-semibold text-slate-500">Zeitraum</div>
          {canManageTaskMeta && detailsEditing ? (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <CustomDatePicker value={detailsDraft.startDate || ""} onChange={(value) => onDetailsDraftChange({ startDate: value })} className="h-9 text-sm" />
              <CustomDatePicker value={detailsDraft.endDate || ""} onChange={(value) => onDetailsDraftChange({ endDate: value })} className="h-9 text-sm" />
            </div>
          ) : (
            <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-slate-800">
              <CalendarDays size={15} />
              {dateRange({ ...task, startDate: meta.startDate, endDate: meta.endDate, deadline: meta.deadline })}
            </div>
          )}
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-500">Zieltermin</div>
          {canManageTaskMeta && detailsEditing ? (
            <CustomDatePicker value={detailsDraft.deadline || ""} onChange={(value) => onDetailsDraftChange({ deadline: value })} className="mt-2 h-9 text-sm" />
          ) : (
            <div className="mt-1 text-sm font-semibold text-slate-800">{meta.deadline ? formatDate(meta.deadline) : "Kein Zieltermin"}</div>
          )}
        </div>
        <div className="border-t border-slate-100 pt-3">
          <div className="text-xs font-semibold text-slate-500">Review</div>
          <div className="mt-1 text-sm font-semibold text-slate-800">{reviewLabel(meta.reviewStatus)}</div>
          {detailsEditing && canManageReviewOwner ? (
            <label className="mt-2 grid gap-1 text-xs font-semibold text-slate-500">
              Review Owner
              <CustomSelect
                value={detailsDraft.reviewOwnerProfileId || ""}
                onChange={(value) => onDetailsDraftChange({ reviewOwnerProfileId: value })}
                className="h-9 text-sm"
                options={[{ value: "", label: "Ohne Review Owner" }, ...profiles.map((profile) => ({ value: profile.id, label: profile.name }))]}
              />
            </label>
          ) : (
            <div className="mt-1 text-xs text-slate-500">
              {reviewOwnerProfile?.name || meta.reviewOwnerProfileId || "Ohne Review Owner"}
              {selfReview ? " · Self-Review" : ""}
            </div>
          )}
          {!canManageReviewOwner && <div className="mt-1 text-[11px] text-slate-400">Nur CEO kann den Review Owner ändern.</div>}
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-500">Score</div>
          <div className="mt-1 text-sm font-semibold text-slate-800">{task.scoreFinal ? `${task.scorePoints} final` : `${task.scorePoints} offen`}</div>
        </div>
        <div className="border-t border-slate-100 pt-3">
          <div className="text-xs font-semibold text-slate-500">Assignee</div>
          <div className="mt-1 text-sm font-semibold text-slate-800">{ownerProfile?.githubLogin || ownerProfile?.name || taskOwnerLabel({ owner: meta.owner })}</div>
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-500">Epic-Ziel</div>
          <div className="mt-1 text-sm text-slate-700">{currentMilestone?.targetDate ? formatDate(currentMilestone.targetDate) : "Kein Zieltermin"}</div>
        </div>
        <div>
          <div className="text-xs font-semibold text-slate-500">Sprint-Zeitraum</div>
          <div className="mt-1 text-sm text-slate-700">{currentSprint ? `${formatDate(currentSprint.startDate)} bis ${formatDate(currentSprint.endDate)}` : "Kein Sprint"}</div>
        </div>
        {currentPackage && (
          <div className="border-t border-slate-100 pt-3">
            <div className="text-xs font-semibold text-slate-500">Initiative-RACI</div>
            <InitiativeRaciList initiative={currentPackage} profiles={profiles} className="mt-2 grid gap-1 text-xs text-slate-600" />
          </div>
        )}
      </div>
    </UiPanel>
  );
}
