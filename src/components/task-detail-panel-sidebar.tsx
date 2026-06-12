"use client";

import { AlertTriangle, CalendarDays, Link2, Trash2 } from "lucide-react";
import { CustomDatePicker } from "@/components/custom-date-picker";
import { CustomSelect } from "@/components/custom-select";
import { dateRange, formatDate, initiativeOptionLabel, initiativeRaciRows, taskOwnerLabel, taskOwnerOptions } from "@/lib/display";
import { hasGitHubIssue, reviewLabel, syncLabel } from "@/lib/platform";
import { normalizeStatus, taskStatuses } from "@/lib/status";
import type { Milestone, Package, Profile, Sprint, Task, TaskStatus } from "@/lib/types";

type Props = {
  task: Task;
  pack?: Package;
  teamProfiles: Profile[];
  packages: Package[];
  sprints: Sprint[];
  milestones: Milestone[];
  canManageTaskMeta: boolean;
  pending: boolean;
  githubProviderTokenAvailable: boolean;
  onUpdate: (patch: Partial<Task>) => void;
  onReconnectGitHub: () => void;
  onSyncGitHub: (options?: { createIfMissing?: boolean }) => void;
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
  pending,
  githubProviderTokenAvailable,
  onUpdate,
  onReconnectGitHub,
  onSyncGitHub,
  onDelete,
}: Props) {
  const ownerProfile = teamProfiles.find((profile) => profile.name === task.owner || profile.id === task.owner);
  const creatorProfile = teamProfiles.find((profile) => profile.name === task.createdBy || profile.id === task.createdBy)
    || teamProfiles.find((profile) => profile.platformRole === "ceo")
    || ownerProfile;
  const currentPackage = packages.find((item) => item.id === task.packageId) || pack;
  const currentSprint = sprints.find((item) => item.id === task.sprintId);
  const currentMilestone = milestones.find((item) => item.id === task.milestoneId);
  const canSyncExistingGitHubIssue = hasGitHubIssue(task);
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
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Status
            <CustomSelect value={normalizeStatus(task.status)} onChange={(value) => onUpdate({ status: value })} className="h-9 text-sm" options={statusOptions.map((status) => ({ value: status, label: status }))} />
          </label>
          {canManageTaskMeta ? (
            <>
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Assignee
                <CustomSelect value={task.owner} onChange={(value) => onUpdate({ owner: value })} className="h-9 text-sm" options={taskOwnerOptions(task.taskType, teamProfiles)} />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Priorität
                <CustomSelect value={task.priority} onChange={(value) => onUpdate({ priority: value })} className="h-9 text-sm" options={["P0", "P1", "P2", "P3", "P4"].map((priority) => ({ value: priority, label: priority }))} />
              </label>
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
            <div className="grid gap-1">
              {initiativeRaciRows(currentPackage, teamProfiles).map((row) => (
                <div key={row.label} className="flex min-w-0 gap-2">
                  <span className="w-4 shrink-0 font-semibold text-blue-700">{row.label}</span>
                  <span className="min-w-0 truncate" title={`${row.title}: ${row.value}`}>{row.value}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-slate-200 p-4">
        <h3 className="text-sm font-semibold text-slate-950">Planung</h3>
        <div className="mt-3 grid gap-3">
          {canManageTaskMeta ? (
            <>
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Initiative
                <CustomSelect value={task.packageId} onChange={updatePackage} className="h-9 text-sm" options={packages.map((item) => ({ value: item.id, label: initiativeOptionLabel(item) }))} />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Sprint
                <CustomSelect value={task.sprintId} onChange={(value) => onUpdate({ sprintId: value })} className="h-9 text-sm" options={sprints.map((item) => ({ value: item.id, label: item.name }))} />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Epic / Meilenstein
                <CustomSelect value={task.milestoneId || ""} onChange={updateMilestone} className="h-9 text-sm" options={[{ value: "", label: "Kein Epic" }, ...milestones.map((item) => ({ value: item.id, label: item.title }))]} />
              </label>
              <div>
                <div className="text-xs font-semibold text-slate-500">Zeitraum</div>
                <div className="mt-1 grid grid-cols-2 gap-2">
                  <CustomDatePicker value={task.startDate || ""} onChange={(value) => onUpdate({ startDate: value })} className="h-9 text-sm" />
                  <CustomDatePicker value={task.endDate || ""} onChange={(value) => onUpdate({ endDate: value })} className="h-9 text-sm" />
                </div>
              </div>
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Zieltermin
                <CustomDatePicker value={task.deadline || ""} onChange={(value) => onUpdate({ deadline: value })} className="h-9 text-sm" />
              </label>
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
            <h3 className="text-sm font-semibold text-slate-950">GitHub</h3>
            <p className="mt-1 text-xs text-slate-500">Backup ins Management-Repo.</p>
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
              {task.githubSyncStatus === "pending" ? "Anlegen..." : "GitHub-Issue anlegen"}
            </button>
          ) : (
            <span className="rounded-full border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-500">Nicht score-relevant</span>
          )}
        </div>
        <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-600">
          <p className="break-words">{task.githubRepo || "findmydoc-platform/management"} · {syncLabel(task.githubSyncStatus)}</p>
          {task.githubIssueUrl ? (
            <a href={task.githubIssueUrl} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1.5 text-blue-700 hover:underline">
              <Link2 size={15} className="shrink-0" />
              <span className="truncate">{task.githubIssueUrl}</span>
            </a>
          ) : (
            <p className="inline-flex items-center gap-1.5 text-amber-700">
              <AlertTriangle size={15} />
              Noch kein GitHub-Issue verknüpft.
            </p>
          )}
          {!hasGitHubIssue(task) && (
            <p className="text-xs text-slate-500">
              Diese Aufgabe wird nicht automatisch dupliziert. Nutze “GitHub-Issue anlegen”, wenn sie bewusst ins Management-Repo gespiegelt werden soll.
            </p>
          )}
          {!githubProviderTokenAvailable && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
              <div className="font-semibold">GitHub-Rechte müssen erneuert werden.</div>
              <p className="mt-1">Du bist weiter in der App angemeldet, aber Sync, Kommentare und Anhänge brauchen einen frischen GitHub-Token.</p>
              <button
                type="button"
                onClick={onReconnectGitHub}
                disabled={pending}
                className="mt-2 h-8 rounded-md border border-amber-200 bg-white px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                GitHub-Rechte erneuern
              </button>
            </div>
          )}
          {task.githubLastSyncedAt && <p className="text-xs text-slate-500">Zuletzt gespiegelt: {task.githubLastSyncedAt}</p>}
          {task.githubSyncError && <p className="break-words text-red-700">{task.githubSyncError}</p>}
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
          {hasGitHubIssue(task) && !githubProviderTokenAvailable && (
            <p className="mt-2 text-xs text-red-700">GitHub-Rechte erneuern, bevor eine verknüpfte Testaufgabe gelöscht wird.</p>
          )}
        </section>
      )}
    </div>
  );
}
