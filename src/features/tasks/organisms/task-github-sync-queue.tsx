"use client";

import { GitBranch, Link2, RefreshCw, X } from "lucide-react";
import { hasGitHubIssue } from "@/lib/platform";
import type { Task } from "@/lib/types";
import { UiBadge, UiButton, UiEmptyState } from "@/shared/atoms/ui-primitives";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";

type LinkedSyncCommand = (options?: { onlyFailed?: boolean }) => void;
type TaskSyncCommand = (task: Task, options?: { createIfMissing?: boolean; silent?: boolean }) => void;

type QueueRow = {
  task: Task;
  hasIssue: boolean;
  issueLabel: string;
  state: "open" | "running" | "locked" | "failed" | "missing";
};

function issueLabel(task: Task) {
  if (task.githubIssueNumber) return `#${task.githubIssueNumber}`;
  if (task.issueNumber) return `#${task.issueNumber}`;
  return "GitHub Issue";
}

function queueState(task: Task, hasIssue: boolean): QueueRow["state"] {
  if (!hasIssue) return "missing";
  if (task.githubSyncStatus === "pending" && task.githubSyncError.includes("läuft bereits")) return "locked";
  if (task.githubSyncStatus === "pending") return "running";
  if (task.githubSyncStatus === "failed") return "failed";
  return "open";
}

function stateBadge(row: QueueRow) {
  if (row.state === "missing") return <UiBadge tone="amber" size="xs">Kein Issue</UiBadge>;
  if (row.state === "locked") return <UiBadge tone="amber" size="xs">gesperrt</UiBadge>;
  if (row.state === "running") return <UiBadge tone="amber" size="xs">läuft</UiBadge>;
  if (row.state === "failed") return <UiBadge tone="red" size="xs">fehlgeschlagen</UiBadge>;
  return <UiBadge tone="blue" size="xs">offen</UiBadge>;
}

export function TaskGitHubSyncQueue({
  open,
  tasks,
  pending,
  githubAppConnected,
  onClose,
  onOpenTask,
  onSyncLinkedGitHubTasks,
  onSyncTaskToGitHub,
}: {
  open: boolean;
  tasks: Task[];
  pending: boolean;
  githubAppConnected: boolean;
  onClose: () => void;
  onOpenTask: (task: Task) => void;
  onSyncLinkedGitHubTasks: LinkedSyncCommand;
  onSyncTaskToGitHub: TaskSyncCommand;
}) {
  const dialogRef = useModalDialog<HTMLDivElement>({ open, onClose });
  if (!open) return null;

  const deliverables = tasks.filter((task) => task.taskType === "deliverable");
  const rows = deliverables
    .map((task) => {
      const linked = hasGitHubIssue(task);
      return { task, hasIssue: linked, issueLabel: issueLabel(task), state: queueState(task, linked) } satisfies QueueRow;
    })
    .filter((row) => row.state !== "open" || row.task.githubSyncStatus !== "synced")
    .filter((row) => row.state !== "open" || row.hasIssue)
    .sort((left, right) => {
      const rank = { failed: 0, locked: 1, running: 2, open: 3, missing: 4 } as const;
      return rank[left.state] - rank[right.state] || left.task.title.localeCompare(right.task.title);
    });
  const linkedRows = rows.filter((row) => row.hasIssue && row.task.githubSyncStatus !== "synced");
  const failedRows = rows.filter((row) => row.state === "failed");
  const missingRows = rows.filter((row) => row.state === "missing");
  const openRows = rows.filter((row) => row.state === "open");

  const canRunLinkedSync = githubAppConnected && !pending && linkedRows.length > 0;
  const rowActionDisabled = (row: QueueRow) => pending || !githubAppConnected || row.state === "running" || row.state === "locked";

  return (
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="GitHub-Sync">
      <button type="button" className="absolute inset-0 bg-slate-950/20" aria-label="GitHub-Sync schließen" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 grid w-full max-w-[560px] grid-rows-[auto_auto_minmax(0,1fr)] border-l border-slate-200 bg-white shadow-2xl">
        <header className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950">
                <GitBranch size={18} />
                GitHub-Sync
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {linkedRows.length} offen · {failedRows.length} Fehler · {missingRows.length} ohne Issue
              </p>
            </div>
            <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="GitHub-Sync schließen">
              <X size={17} />
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <UiButton disabled={!canRunLinkedSync} onClick={() => onSyncLinkedGitHubTasks()} variant="primary">
              <RefreshCw size={15} />
              Offene Issues syncen
            </UiButton>
            <UiButton disabled={!githubAppConnected || pending || !failedRows.length} onClick={() => onSyncLinkedGitHubTasks({ onlyFailed: true })}>
              Fehler erneut versuchen
            </UiButton>
          </div>
        </header>

        {!githubAppConnected && (
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm font-medium text-amber-800">
            GitHub-App-Verbindung fehlt. Bitte nutze die zentrale Verbindung im Header.
          </div>
        )}

        <div className="min-h-0 overflow-y-auto p-4">
          <div className="grid gap-2">
            {rows.map((row) => (
              <article key={row.task.id} className="grid min-h-20 grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-md border border-slate-200 bg-white px-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {stateBadge(row)}
                    <span className="text-xs font-semibold text-slate-500">{row.hasIssue ? row.issueLabel : "Noch kein GitHub Issue"}</span>
                  </div>
                  <button type="button" onClick={() => onOpenTask(row.task)} className="mt-1 block min-w-0 max-w-full truncate text-left text-sm font-semibold text-slate-950 hover:text-blue-700">
                    {row.task.title}
                  </button>
                  <p className="mt-1 line-clamp-1 text-xs text-slate-500">
                    {row.state === "locked"
                      ? "Sync läuft bereits."
                      : row.state === "failed"
                        ? row.task.githubSyncError || "GitHub-Sync fehlgeschlagen."
                        : row.state === "missing"
                          ? "GitHub Issue bewusst anlegen."
                          : row.state === "running"
                            ? "GitHub-Sync läuft."
                            : "GitHub-Sync offen."}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-2">
                  {row.hasIssue ? (
                    <UiButton size="xs" disabled={rowActionDisabled(row)} onClick={() => onSyncTaskToGitHub(row.task)}>
                      {row.state === "failed" ? "Erneut versuchen" : "Sync"}
                    </UiButton>
                  ) : (
                    <UiButton size="xs" variant="amber" disabled={rowActionDisabled(row)} onClick={() => onSyncTaskToGitHub(row.task, { createIfMissing: true })}>
                      GitHub Issue anlegen
                    </UiButton>
                  )}
                  {row.task.githubIssueUrl && (
                    <a href={row.task.githubIssueUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 hover:underline">
                      <Link2 size={12} />
                      Issue öffnen
                    </a>
                  )}
                </div>
              </article>
            ))}
            {!rows.length && (
              <UiEmptyState tone="muted" minHeight="md">
                GitHub ist aktuell.
              </UiEmptyState>
            )}
          </div>
          {openRows.length > 0 && (
            <p className="mt-3 text-xs text-slate-500">
              {openRows.length} verknüpfte Issues warten auf Aktualisierung.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}
