"use client";

import { CircleAlert, Link2, X } from "lucide-react";
import Image from "next/image";
import { useCallback, useState } from "react";
import type { GitHubUserConnectionState } from "@/features/planning/model/github-app-connection";
import { TaskReferenceLink } from "@/features/tasks/atoms/task-reference-link";
import { GitHubConnectionInfo } from "@/features/tasks/molecules/github-connection-info";
import { isExpiredGitHubSyncPending, projectGitHubSyncQueue } from "@/features/tasks/model/github-sync-queue";
import { hasGitHubIssue } from "@/lib/platform";
import type { Task, TaskComment } from "@/lib/types";
import { UiButton, UiEmptyState } from "@/shared/atoms/ui-primitives";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";

type LinkedSyncCommand = (options?: { onlyFailed?: boolean }) => void;
type TaskSyncCommand = (task: Task, options?: { createIfMissing?: boolean; silent?: boolean }) => void;

type QueueRow = {
  task: Task;
  hasIssue: boolean;
  issueLabel: string;
  parent?: Task;
  state: "open" | "comments_waiting" | "comments_failed" | "running" | "locked" | "failed" | "missing" | "waiting_for_parent" | "parent_failed";
};

function issueLabel(task: Task) {
  if (task.githubIssueNumber) return `#${task.githubIssueNumber}`;
  if (task.issueNumber) return `#${task.issueNumber}`;
  return "GitHub Issue";
}

function queueState(task: Task, parent: Task | undefined, hasIssue: boolean, hasOpenComments: boolean, hasFailedComments: boolean): QueueRow["state"] {
  if (task.taskType === "sub_issue" && parent?.githubIssueSyncStatus === "failed") return "parent_failed";
  if (task.taskType === "sub_issue" && (!parent || !hasGitHubIssue(parent))) return "waiting_for_parent";
  if (!hasIssue) return "missing";
  if (isExpiredGitHubSyncPending(task)) return "open";
  if (task.githubIssueSyncStatus === "pending" && task.githubIssueSyncError.includes("läuft bereits")) return "locked";
  if (task.githubIssueSyncStatus === "pending") return "running";
  if (task.githubIssueSyncStatus === "failed") return "failed";
  if (hasFailedComments) return "comments_failed";
  if (hasOpenComments) return "comments_waiting";
  return "open";
}

function stateDescription(row: QueueRow) {
  if (row.state === "locked") return "Sync läuft bereits";
  if (row.state === "failed") return row.task.githubIssueSyncError || "GitHub-Sync fehlgeschlagen";
  if (row.state === "parent_failed") return "Parent-Sync fehlgeschlagen; Sub-Issue wird übersprungen";
  if (row.state === "waiting_for_parent") return "Sub-Issue wartet auf Parent-Deliverable";
  if (row.state === "missing") return "GitHub Issue fehlt";
  if (row.state === "comments_failed") return "Kommentarzustellung fehlgeschlagen";
  if (row.state === "comments_waiting") return "Kommentare warten auf Zustellung";
  if (row.state === "running") return "GitHub-Sync läuft";
  return "Änderungen offen";
}

export function TaskGitHubSyncQueue({
  open,
  tasks,
  comments,
  pending,
  githubInstallationAvailable,
  githubUserConnected,
  githubConnectionState,
  waitingGitHubCommentCount,
  githubReauthFailed,
  authBusy,
  localMode = false,
  notice,
  onClose,
  onOpenTask,
  onReconnect,
  onSyncLinkedGitHubTasks,
  onSyncTaskToGitHub,
}: {
  open: boolean;
  tasks: Task[];
  comments: TaskComment[];
  pending: boolean;
  githubInstallationAvailable: boolean;
  githubUserConnected: boolean;
  githubConnectionState: GitHubUserConnectionState;
  waitingGitHubCommentCount: number;
  githubReauthFailed: boolean;
  authBusy: boolean;
  localMode?: boolean;
  notice?: string;
  onClose: () => void;
  onOpenTask: (taskId: string) => void;
  onReconnect: () => void;
  onSyncLinkedGitHubTasks: LinkedSyncCommand;
  onSyncTaskToGitHub: TaskSyncCommand;
}) {
  const [connectionInfoOpen, setConnectionInfoOpen] = useState(false);
  const closeQueue = useCallback(() => {
    setConnectionInfoOpen(false);
    onClose();
  }, [onClose]);
  const dialogRef = useModalDialog<HTMLDivElement>({ open, onClose: closeQueue });

  if (!open) return null;

  const taskById = new Map(tasks.map((task) => [task.id, task]));
  const queue = projectGitHubSyncQueue(tasks, comments);
  const rows = queue.tasks
    .map((task) => {
      const linked = hasGitHubIssue(task);
      const parent = task.taskType === "sub_issue" ? taskById.get(task.parentTaskId) : undefined;
      return {
        task,
        parent,
        hasIssue: linked,
        issueLabel: issueLabel(task),
        state: queueState(
          task,
          parent,
          linked,
          queue.openCommentTaskIds.has(task.id),
          queue.failedCommentTaskIds.has(task.id),
        ),
      } satisfies QueueRow;
    });

  const bulkRunnableRows = rows.filter((row) => row.state !== "running" && row.state !== "locked");
  const canRunLinkedSync = githubInstallationAvailable && !pending && bulkRunnableRows.length > 0;
  const rowActionDisabled = (row: QueueRow) => pending || !githubInstallationAvailable || row.state === "running" || row.state === "locked" || row.state === "waiting_for_parent" || row.state === "parent_failed";

  return (
    <div ref={dialogRef} tabIndex={-1} className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="GitHub-Sync">
      <button type="button" className="absolute inset-0 bg-slate-950/[0.02]" aria-label="GitHub-Sync schließen" onClick={closeQueue} />
      <aside className="absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col border-l border-slate-200 bg-white shadow-2xl">
        <header className="relative z-20 border-b border-slate-200 px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-slate-200 bg-white">
                <Image src="/github-mark.svg" width={22} height={22} alt="" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold leading-6 text-slate-950">GitHub</h2>
                <GitHubConnectionInfo
                  installationAvailable={githubInstallationAvailable}
                  userConnected={githubUserConnected}
                  waitingCommentCount={waitingGitHubCommentCount}
                  failed={githubReauthFailed}
                  busy={authBusy}
                  localMode={localMode}
                  state={githubConnectionState}
                  open={connectionInfoOpen}
                  onOpenChange={setConnectionInfoOpen}
                  onReconnect={onReconnect}
                />
              </div>
            </div>
            <button
              type="button"
              onClick={closeQueue}
              className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-500 transition hover:bg-slate-50 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="GitHub schließen"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        </header>

        {notice && (
          <div className="border-b border-blue-100 bg-blue-50 px-5 py-3 text-sm font-medium text-blue-800">
            {notice}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto px-5">
          <h3 className="border-b border-slate-100 py-4 text-base font-semibold text-slate-950">
            {rows.length > 0 ? `${rows.length} ${rows.length === 1 ? "Aktion" : "Aktionen"} erforderlich` : "GitHub ist aktuell"}
          </h3>
          <div>
            {rows.map((row) => {
              const hasError = row.state === "failed" || row.state === "parent_failed" || row.state === "comments_failed";
              return (
              <article key={row.task.id} className="grid grid-cols-[24px_minmax(0,1fr)] gap-3 border-b border-slate-100 py-5 sm:grid-cols-[24px_minmax(0,1fr)_auto] sm:items-center">
                <CircleAlert
                  size={20}
                  className={`mt-0.5 ${hasError ? "text-red-500" : "text-amber-500"}`}
                  aria-hidden="true"
                />
                <div className="min-w-0">
                  <TaskReferenceLink task={row.task} onOpenTask={onOpenTask} showIcon={false} className="max-w-full text-left text-sm font-semibold leading-5 text-slate-950">
                    {row.task.title}
                  </TaskReferenceLink>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                    {row.hasIssue ? (
                      <TaskReferenceLink task={row.task} onOpenTask={onOpenTask} showIcon={false} className="font-semibold text-blue-700">
                        {row.issueLabel}
                      </TaskReferenceLink>
                    ) : (
                      <span className="font-semibold text-slate-500">Noch kein GitHub Issue</span>
                    )}
                    <span className={hasError ? "text-red-600" : "text-slate-500"}>
                      {stateDescription(row)}
                    </span>
                  </div>
                  {row.parent && <p className="mt-1 text-xs text-slate-500">Sub-Issue von: {row.parent.title}</p>}
                </div>
                <div className="col-start-2 flex shrink-0 items-center gap-2 sm:col-start-auto sm:justify-end">
                  {row.hasIssue ? (
                    <UiButton size="xs" variant="blueOutline" disabled={rowActionDisabled(row)} onClick={() => onSyncTaskToGitHub(row.task)}>
                      {row.state === "failed" || row.state === "comments_failed" ? "Erneut versuchen" : row.state === "running" || row.state === "locked" ? "Läuft" : "Synchronisieren"}
                    </UiButton>
                  ) : (
                    <UiButton size="xs" variant="blueOutline" disabled={rowActionDisabled(row)} onClick={() => onSyncTaskToGitHub(row.task, { createIfMissing: true })}>
                      Issue anlegen
                    </UiButton>
                  )}
                  {row.task.githubIssueUrl && (
                    <a href={row.task.githubIssueUrl} target="_blank" rel="noreferrer" className="grid h-8 w-8 place-items-center rounded-md text-slate-400 transition hover:bg-slate-50 hover:text-blue-700" aria-label={`${row.issueLabel} in GitHub öffnen`}>
                      <Link2 size={15} aria-hidden="true" />
                    </a>
                  )}
                </div>
              </article>
              );
            })}
            {!rows.length && (
              <UiEmptyState tone="muted" minHeight="md" className="my-5">
                Alle freigegebenen Aufgaben sind mit GitHub abgeglichen.
              </UiEmptyState>
            )}
          </div>
        </div>

        <footer className="border-t border-slate-200 bg-white px-5 py-4">
          <UiButton className="w-full" size="lg" variant="primary" disabled={!canRunLinkedSync} onClick={() => onSyncLinkedGitHubTasks()}>
            {pending
              ? "Aktionen werden ausgeführt..."
              : bulkRunnableRows.length > 0
                ? `${bulkRunnableRows.length} ${bulkRunnableRows.length === 1 ? "Aktion" : "Aktionen"} ausführen`
                : rows.length > 0
                  ? "Keine ausführbaren Aktionen"
                : "GitHub ist aktuell"}
          </UiButton>
        </footer>
      </aside>
    </div>
  );
}
