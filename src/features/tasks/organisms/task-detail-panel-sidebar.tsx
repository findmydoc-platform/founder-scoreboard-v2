"use client";

import { CalendarDays, Link2, Trash2 } from "lucide-react";
import { InitiativeRaciList } from "@/features/projects/molecules/initiative-raci-list";
import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { UiDateField, UiSelectField } from "@/shared/atoms/form-controls";
import { dateRange, formatDate, taskOwnerLabel } from "@/lib/display";
import { hasGitHubIssue, reviewLabel, syncLabel } from "@/lib/platform";
import { normalizeStatus, taskStatuses } from "@/lib/status";
import {
  assigneeOptions,
  initiativeOptions,
  milestoneOptions,
  priorityOptions,
  sprintOptions,
} from "@/features/tasks/model/task-form-options";
import type { Milestone, Package, Profile, Sprint, Task, TaskStatus } from "@/lib/types";

type Props = {
  task: Task;
  pack?: Package;
  teamProfiles: Profile[];
  packages: Package[];
  sprints: Sprint[];
  milestones: Milestone[];
  canManageTaskMeta: boolean;
  canManageReviewOwner: boolean;
  canChangeTaskStatus?: boolean;
  pending: boolean;
  githubProviderTokenAvailable: boolean;
  onUpdate: (patch: Partial<Task>) => void;
  onSyncGitHub: (options?: { createIfMissing?: boolean }) => void;
  onOpenReview: () => void;
  onDelete: () => void;
};

export function TaskDetailPanelSidebar({
  task,
  pack,
  teamProfiles,
  packages,
  sprints,
  milestones,
  canManageTaskMeta,
  canManageReviewOwner,
  canChangeTaskStatus = canManageTaskMeta,
  pending,
  githubProviderTokenAvailable,
  onUpdate,
  onSyncGitHub,
  onOpenReview,
  onDelete,
}: Props) {
  const ownerProfile = teamProfiles.find((profile) => profile.name === task.owner || profile.id === task.owner);
  const reviewOwnerProfile = teamProfiles.find((profile) => profile.id === task.reviewOwnerProfileId);
  const selfReview = Boolean(task.reviewOwnerProfileId && (task.ownerId === task.reviewOwnerProfileId || task.owner === task.reviewOwnerProfileId));
  const creatorProfile = teamProfiles.find((profile) => profile.name === task.createdBy || profile.id === task.createdBy)
    || teamProfiles.find((profile) => profile.platformRole === "ceo")
    || ownerProfile;
  const currentPackage = packages.find((item) => item.id === task.packageId) || pack;
  const currentSprint = sprints.find((item) => item.id === task.sprintId);
  const currentMilestone = milestones.find((item) => item.id === task.milestoneId);
  const canSyncExistingGitHubIssue = hasGitHubIssue(task);
  const reviewOpen = !task.scoreFinal && (normalizeStatus(task.status) === "Review" || task.reviewStatus === "requested");
  const statusOptions = canManageTaskMeta
    ? taskStatuses
    : normalizeStatus(task.status) === "Nacharbeit"
      ? (["In Arbeit", "Review", "Blockiert"] as TaskStatus[])
      : taskStatuses.filter((status) => status !== "Erledigt");

  const updatePackage = (packageId: string) => {
    const nextPackage = packages.find((item) => item.id === packageId);
    onUpdate({ packageId, milestoneId: nextPackage?.milestoneId || task.milestoneId });
  };

  const updateMilestone = (milestoneId: string) => {
    const nextPackage = packages.find((item) => !milestoneId || !item.milestoneId || item.milestoneId === milestoneId);
    onUpdate({ milestoneId, packageId: nextPackage?.id || task.packageId });
  };

  return (
    <div className="grid h-fit min-w-0 gap-4 lg:sticky lg:top-24">
      <section className="rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-950">Steuerung</h3>
        <div className="mt-3 grid gap-3">
          <UiSelectField
            label="Status"
            value={normalizeStatus(task.status)}
            disabled={!canChangeTaskStatus}
            onChange={(value) => onUpdate({ status: value })}
            options={(canChangeTaskStatus ? statusOptions : [normalizeStatus(task.status)]).map((status) => ({ value: status, label: status }))}
          />
          {canManageTaskMeta ? (
            <>
              <UiSelectField
                label="Assignee"
                value={task.owner}
                onChange={(value) => onUpdate({ owner: value })}
                options={assigneeOptions(task.taskType, teamProfiles)}
              />
              <UiSelectField label="Priorität" value={task.priority} onChange={(value) => onUpdate({ priority: value })} options={priorityOptions} />
            </>
          ) : (
            <>
              <div>
                <div className="text-xs font-semibold text-slate-500">Assignee</div>
                <div className="mt-1 flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-800">{taskOwnerLabel(task)}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">Priorität</div>
                <div className="mt-1 text-sm font-semibold text-slate-800">{task.priority}</div>
              </div>
            </>
          )}
        </div>
        {currentPackage && (
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600">
            <div className="mb-1 font-semibold text-slate-700">Initiative-RACI</div>
            <InitiativeRaciList initiative={currentPackage} profiles={teamProfiles} className="grid gap-1" />
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-950">Planung</h3>
        <div className="mt-3 grid gap-3">
          {canManageTaskMeta ? (
            <>
              <UiSelectField label="Initiative" value={task.packageId} onChange={updatePackage} options={initiativeOptions(packages)} />
              <UiSelectField label="Sprint" value={task.sprintId} onChange={(value) => onUpdate({ sprintId: value })} options={sprintOptions(sprints)} />
              <UiSelectField
                label="Epic / Meilenstein"
                value={task.milestoneId || ""}
                onChange={updateMilestone}
                options={milestoneOptions(milestones, "Kein Epic")}
              />
              <div>
                <div className="text-xs font-semibold text-slate-500">Zeitraum</div>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <CustomDatePicker value={task.startDate || ""} onChange={(value) => onUpdate({ startDate: value })} className="h-9 text-sm" />
                  <CustomDatePicker value={task.endDate || ""} onChange={(value) => onUpdate({ endDate: value })} className="h-9 text-sm" />
                </div>
              </div>
              <UiDateField label="Zieltermin" value={task.deadline || ""} onChange={(value) => onUpdate({ deadline: value })} />
            </>
          ) : (
            <>
              <div>
                <div className="text-xs font-semibold text-slate-500">Initiative</div>
                <div className="mt-1 break-words text-sm text-slate-800">{currentPackage ? currentPackage.title : "ohne Initiative"}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">Sprint</div>
                <div className="mt-1 text-sm text-slate-800">{currentSprint?.name || "Kein Sprint"}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">Epic / Meilenstein</div>
                <div className="mt-1 break-words text-sm text-slate-800">{currentMilestone?.title || "Kein Epic"}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">Zeitraum</div>
                <div className="mt-1 flex items-center gap-2 text-sm text-slate-800"><CalendarDays size={15} />{dateRange(task)}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">Zieltermin</div>
                <div className="mt-1 text-sm text-slate-800">{task.deadline ? formatDate(task.deadline) : "Kein Zieltermin"}</div>
              </div>
            </>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-950">Review & Historie</h3>
        <div className="mt-3 grid gap-3 text-sm text-slate-800">
          <div>
            <div className="text-xs font-semibold text-slate-500">Review</div>
            <div className="mt-1">{reviewLabel(task.reviewStatus)} · {task.scoreFinal ? `${task.scorePoints} Punkte final` : "noch nicht final bewertet"}</div>
            {reviewOpen ? (
              <button
                type="button"
                disabled={pending}
                onClick={onOpenReview}
                className="mt-2 h-8 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Zum Review-Blatt
              </button>
            ) : null}
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500">Review Owner</div>
            {canManageReviewOwner ? (
              <CustomSelect
                value={task.reviewOwnerProfileId || ""}
                onChange={(value) => onUpdate({ reviewOwnerProfileId: value })}
                className="mt-1 h-9 text-sm"
                options={[{ value: "", label: "Ohne Review Owner" }, ...teamProfiles.map((profile) => ({ value: profile.id, label: profile.name }))]}
              />
            ) : (
              <div className="mt-1">
                {reviewOwnerProfile?.name || task.reviewOwnerProfileId || "Ohne Review Owner"}
                {selfReview ? <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700">Self-Review</span> : null}
              </div>
            )}
            {!canManageReviewOwner ? <div className="mt-1 text-[11px] text-slate-400">Nur CEO kann den Review Owner ändern.</div> : null}
            {task.reviewRequestedAt ? (
              <div className="mt-1 text-xs text-slate-500">Angefragt am {new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(task.reviewRequestedAt))}</div>
            ) : null}
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500">Erstellt von</div>
            <div className="mt-1">{creatorProfile?.name || task.createdBy || "Unbekannt"}</div>
          </div>
          {(task.carriedFromSprintId || task.carryoverReason || task.sprintOutcome) && (
            <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm leading-6 text-blue-900">
              <div className="font-semibold">Sprint-Verlauf</div>
              {task.carriedFromSprintId && <div>Aus Sprint {task.carriedFromSprintId} übertragen.</div>}
              {task.sprintOutcome && <div>Outcome im ursprünglichen Sprint: {task.sprintOutcome}</div>}
              {task.carryoverReason && <div>{task.carryoverReason}</div>}
            </div>
          )}
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-950">Externe Ablage</h3>
            <p className="mt-1 text-xs text-slate-500">Optional in GitHub spiegeln.</p>
          </div>
          {canSyncExistingGitHubIssue ? (
            <button
              type="button"
              disabled={pending || task.githubSyncStatus === "pending" || !githubProviderTokenAvailable}
              onClick={() => onSyncGitHub()}
              className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {task.githubSyncStatus === "pending" ? "Sync..." : "Jetzt spiegeln"}
            </button>
          ) : task.taskType === "deliverable" ? (
            <button
              type="button"
              disabled={pending || task.githubSyncStatus === "pending" || !githubProviderTokenAvailable}
              onClick={() => onSyncGitHub({ createIfMissing: true })}
              className="h-8 rounded-md border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {task.githubSyncStatus === "pending" ? "Anlegen..." : "Issue anlegen"}
            </button>
          ) : (
            <span className="rounded-full border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-500">Nicht score-relevant</span>
          )}
        </div>
        <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-600">
          <p className="break-words font-medium text-slate-800">{hasGitHubIssue(task) ? "Verknüpft" : "Nur in der App"} · {syncLabel(task.githubSyncStatus)}</p>
          {task.githubIssueUrl ? (
            <a href={task.githubIssueUrl} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1.5 text-blue-700 hover:underline">
              <Link2 size={15} className="shrink-0" />
              <span className="truncate">Verknüpftes Issue öffnen</span>
            </a>
          ) : (
            <p className="text-slate-500">Noch nicht extern abgelegt.</p>
          )}
          {!hasGitHubIssue(task) && (
            <p className="text-xs text-slate-500">
              Nutze „Issue anlegen“ nur, wenn diese Aufgabe bewusst extern gespiegelt werden soll.
            </p>
          )}
          <details className="mt-1 rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
            <summary className="cursor-pointer list-none text-xs font-semibold text-slate-500">Ablagedetails anzeigen</summary>
            <div className="mt-2 grid gap-1 text-xs text-slate-500">
              <p className="break-words">Repository: {task.githubRepo || "findmydoc-platform/management"}</p>
              {task.githubLastSyncedAt && <p>Zuletzt gespiegelt: {task.githubLastSyncedAt}</p>}
              {task.githubSyncError && <p className="break-words text-red-700">{task.githubSyncError}</p>}
            </div>
          </details>
        </div>
      </section>

      {canManageTaskMeta && (
        <section className="rounded-lg border border-red-100 bg-red-50/40 p-4">
          <h3 className="text-sm font-semibold text-red-950">Test & Bereinigung</h3>
          <p className="mt-1 text-xs leading-5 text-red-800">
            Löscht die Aufgabe aus der App. Ein verknüpftes GitHub-Issue wird vorher geschlossen und als Test/Löschung markiert.
          </p>
          <button
            type="button"
            disabled={pending || (hasGitHubIssue(task) && !githubProviderTokenAvailable)}
            onClick={onDelete}
            className="mt-3 inline-flex h-8 items-center gap-2 rounded-md border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Trash2 size={14} />
            Aufgabe löschen
          </button>
        </section>
      )}
    </div>
  );
}
