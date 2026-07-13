"use client";

import { GitBranch, Link2, RefreshCw, X } from "lucide-react";
import { TaskReferenceLink } from "@/features/tasks/atoms/task-reference-link";
import { isExpiredGitHubSyncPending, isGitHubSyncEligible, sortGitHubSyncTasks, taskNeedsGitHubSync } from "@/features/tasks/model/github-sync-queue";
import { hasGitHubIssue } from "@/lib/platform";
import type { Task, TaskComment } from "@/lib/types";
import { UiBadge, UiButton, UiEmptyState } from "@/shared/atoms/ui-primitives";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";

type LinkedSyncCommand = (options?: { onlyFailed?: boolean }) => void;
type TaskSyncCommand = (task: Task, options?: { createIfMissing?: boolean; silent?: boolean }) => void;

type QueueRow = {
  task: Task;
  hasIssue: boolean;
  issueLabel: string;
  parent?: Task;
  state: "open" | "comments_waiting" | "running" | "locked" | "failed" | "missing" | "waiting_for_parent" | "parent_failed";
};

function issueLabel(task: Task) {
  if (task.githubIssueNumber) return `#${task.githubIssueNumber}`;
  if (task.issueNumber) return `#${task.issueNumber}`;
  return "GitHub Issue";
}

function queueState(task: Task, parent: Task | undefined, hasIssue: boolean, hasOpenComments: boolean): QueueRow["state"] {
  if (task.taskType === "sub_issue" && parent?.githubIssueSyncStatus === "failed") return "parent_failed";
  if (task.taskType === "sub_issue" && (!parent || !hasGitHubIssue(parent))) return "waiting_for_parent";
  if (!hasIssue) return "missing";
  if (isExpiredGitHubSyncPending(task)) return "open";
  if (task.githubIssueSyncStatus === "pending" && task.githubIssueSyncError.includes("läuft bereits")) return "locked";
  if (task.githubIssueSyncStatus === "pending") return "running";
  if (task.githubIssueSyncStatus === "failed") return "failed";
  if (hasOpenComments) return "comments_waiting";
  return "open";
}

function stateBadge(row: QueueRow) {
  if (row.state === "missing") return <UiBadge tone="amber" size="xs">Kein GitHub Issue</UiBadge>;
  if (row.state === "locked") return <UiBadge tone="amber" size="xs">gesperrt</UiBadge>;
  if (row.state === "running") return <UiBadge tone="amber" size="xs">läuft</UiBadge>;
  if (row.state === "failed") return <UiBadge tone="red" size="xs">fehlgeschlagen</UiBadge>;
  if (row.state === "parent_failed") return <UiBadge tone="red" size="xs">Parent fehlgeschlagen</UiBadge>;
  if (row.state === "waiting_for_parent") return <UiBadge tone="amber" size="xs">wartet auf Parent</UiBadge>;
  if (row.state === "comments_waiting") return <UiBadge tone="blue" size="xs">Kommentare offen</UiBadge>;
  return <UiBadge tone="blue" size="xs">offen</UiBadge>;
}

export function TaskGitHubSyncQueue({
  open,
  tasks,
  comments,
  pending,
  githubInstallationAvailable,
  notice,
  onClose,
  onOpenTask,
  onSyncLinkedGitHubTasks,
  onSyncTaskToGitHub,
}: {
  open: boolean;
  tasks: Task[];
  comments: TaskComment[];
  pending: boolean;
  githubInstallationAvailable: boolean;
  notice?: string;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
  onSyncLinkedGitHubTasks: LinkedSyncCommand;
  onSyncTaskToGitHub: TaskSyncCommand;
}) {
  const dialogRef = useModalDialog<HTMLDivElement>({ open, onClose });
  if (!open) return null;

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const openCommentTaskIds = new Set(comments
    .filter((comment) => comment.githubDeliveryStatus !== "delivered")
    .map((comment) => comment.taskId));
  const rows = sortGitHubSyncTasks(tasks.filter((task) => isGitHubSyncEligible(task) && taskNeedsGitHubSync(task, openCommentTaskIds)), tasks)
    .map((task) => {
      const linked = hasGitHubIssue(task);
      const parent = task.taskType === "sub_issue" ? taskById.get(task.parentTaskId) : undefined;
      return { task, parent, hasIssue: linked, issueLabel: issueLabel(task), state: queueState(task, parent, linked, openCommentTaskIds.has(task.id)) } satisfies QueueRow;
    })
  const linkedRows = rows.filter((row) => row.hasIssue && (row.task.githubIssueSyncStatus !== "synced" || row.state === "comments_waiting"));
  const failedCommentTaskIds = new Set(comments.filter((comment) => comment.githubDeliveryStatus === "failed").map((comment) => comment.taskId));
  const failedRows = rows.filter((row) => row.state === "failed" || failedCommentTaskIds.has(row.task.id));
  const missingRows = rows.filter((row) => row.state === "missing");
  const openRows = rows.filter((row) => row.state === "open");

  const canRunLinkedSync = githubInstallationAvailable && !pending && rows.length > 0;
  const rowActionDisabled = (row: QueueRow) => pending || !githubInstallationAvailable || row.state === "running" || row.state === "locked" || row.state === "waiting_for_parent" || row.state === "parent_failed";

  return (
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="GitHub-Sync">
      <button type="button" className="absolute inset-0 bg-slate-950/20" aria-label="GitHub-Sync schließen" onClick={onClose} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col border-l border-slate-200 bg-white shadow-2xl">
        <header className="border-b border-slate-200 px-5 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950">
                <GitBranch size={18} />
                GitHub-Sync
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {linkedRows.length} offen · {failedRows.length} Fehler · {missingRows.length} ohne GitHub Issue
              </p>
            </div>
            <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="GitHub-Sync schließen">
              <X size={17} />
            </button>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <UiButton disabled={!canRunLinkedSync} onClick={() => onSyncLinkedGitHubTasks()} variant="primary">
              <RefreshCw size={15} />
              Offene GitHub Issues syncen
            </UiButton>
            <UiButton disabled={!githubInstallationAvailable || pending || !failedRows.length} onClick={() => onSyncLinkedGitHubTasks({ onlyFailed: true })}>
              Fehler erneut versuchen
            </UiButton>
          </div>
        </header>

        {!githubInstallationAvailable && (
          <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-sm font-medium text-amber-800">
            Die technische GitHub-App-Installation ist nicht verfügbar.
          </div>
        )}

        {notice && (
          <div className="border-b border-blue-100 bg-blue-50 px-5 py-3 text-sm font-medium text-blue-800">
            {notice}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="grid gap-2">
            {rows.map((row) => (
              <article key={row.task.id} className="grid min-h-20 grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-md border border-slate-200 bg-white px-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {stateBadge(row)}
                    {row.hasIssue ? (
                      <TaskReferenceLink task={row.task} onOpenTask={onOpenTask} showIcon={false} className="text-xs font-semibold text-slate-500">
                        {row.issueLabel}
                      </TaskReferenceLink>
                    ) : (
                      <span className="text-xs font-semibold text-slate-500">Noch kein GitHub Issue</span>
                    )}
                  </div>
                  <TaskReferenceLink task={row.task} onOpenTask={onOpenTask} className="mt-1 max-w-full text-left text-sm font-semibold text-slate-950">
                    {row.task.title}
                  </TaskReferenceLink>
                  {row.parent && <p className="mt-1 text-xs text-slate-500">Sub-Issue von: {row.parent.title}</p>}
                  <p className="mt-1 line-clamp-1 text-xs text-slate-500">
                    {row.state === "locked"
                      ? "Sync läuft bereits."
                      : row.state === "failed"
                        ? row.task.githubIssueSyncError || "GitHub-Sync fehlgeschlagen."
                        : row.state === "parent_failed"
                          ? "Parent-Sync fehlgeschlagen; Sub-Issue wird übersprungen."
                          : row.state === "waiting_for_parent"
                            ? "Parent-Issue wird im Sammel-Sync zuerst angelegt."
                        : row.state === "missing"
                          ? "GitHub Issue bewusst anlegen."
                          : row.state === "comments_waiting"
                            ? "Issue aktuell · Kommentare warten auf Zustellung."
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
