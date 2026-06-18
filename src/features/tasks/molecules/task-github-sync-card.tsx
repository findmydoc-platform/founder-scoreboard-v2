import { AlertTriangle, GitBranch, Link2, MessageSquareWarning } from "lucide-react";
import { syncLabel } from "@/lib/platform";
import type { Task } from "@/lib/types";

type GitHubSyncState = Pick<Task, "githubRepo" | "githubIssueUrl" | "githubSyncStatus" | "githubLastSyncedAt" | "githubSyncError">;

export function TaskGitHubSyncCard({
  taskType,
  githubState,
  canSyncExistingGitHubIssue,
  pending,
  githubProviderTokenAvailable,
  onSyncGitHub,
  onCreateGitHubIssue,
  onReconnectGitHub,
}: {
  taskType: Task["taskType"];
  githubState: GitHubSyncState;
  canSyncExistingGitHubIssue: boolean;
  pending: boolean;
  githubProviderTokenAvailable: boolean;
  onSyncGitHub: () => void;
  onCreateGitHubIssue: () => void;
  onReconnectGitHub: () => void;
}) {
  const syncPending = githubState.githubSyncStatus === "pending";

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-950">
          <GitBranch size={16} />
          GitHub Sync
        </h2>
        {canSyncExistingGitHubIssue ? (
          <button
            type="button"
            disabled={pending || syncPending || !githubProviderTokenAvailable}
            onClick={onSyncGitHub}
            className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncPending ? "Sync..." : "Jetzt spiegeln"}
          </button>
        ) : taskType === "deliverable" ? (
          <button
            type="button"
            disabled={pending || syncPending || !githubProviderTokenAvailable}
            onClick={onCreateGitHubIssue}
            className="h-8 rounded-md border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncPending ? "Anlegen..." : "GitHub-Issue anlegen"}
          </button>
        ) : null}
      </div>
      <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-600">
        <p>{githubState.githubRepo || "findmydoc-platform/management"} · {syncLabel(githubState.githubSyncStatus)}</p>
        {githubState.githubIssueUrl ? (
          <a href={githubState.githubIssueUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-blue-700 hover:underline">
            <Link2 size={14} />
            GitHub-Issue öffnen
          </a>
        ) : (
          <p className="inline-flex items-center gap-1.5 text-amber-700">
            <AlertTriangle size={15} />
            Nur in der App: noch kein GitHub-Issue verknüpft.
          </p>
        )}
        {!canSyncExistingGitHubIssue && <p className="text-xs text-slate-500">Diese Aufgabe wird nicht automatisch dupliziert. Nutze “GitHub-Issue anlegen”, wenn sie bewusst ins Management-Repo gespiegelt werden soll.</p>}
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
        {githubState.githubLastSyncedAt && <p className="text-xs text-slate-500">Zuletzt gespiegelt: {githubState.githubLastSyncedAt}</p>}
        {githubState.githubSyncError && <p className="flex gap-2 text-red-700"><MessageSquareWarning size={16} />{githubState.githubSyncError}</p>}
      </div>
    </section>
  );
}
