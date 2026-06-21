import { GitBranch, Link2, MessageSquareWarning } from "lucide-react";
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
}: {
  taskType: Task["taskType"];
  githubState: GitHubSyncState;
  canSyncExistingGitHubIssue: boolean;
  pending: boolean;
  githubProviderTokenAvailable: boolean;
  onSyncGitHub: () => void;
  onCreateGitHubIssue: () => void;
}) {
  const syncPending = githubState.githubSyncStatus === "pending";

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-950">
          <GitBranch size={16} />
          Externe Ablage
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
            {syncPending ? "Anlegen..." : "Issue anlegen"}
          </button>
        ) : null}
      </div>
      <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-600">
        <p className="font-medium text-slate-800">{githubState.githubIssueUrl ? "Verknüpft" : "Nur in der App"} · {syncLabel(githubState.githubSyncStatus)}</p>
        {githubState.githubIssueUrl ? (
          <a href={githubState.githubIssueUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-blue-700 hover:underline">
            <Link2 size={14} />
            Verknüpftes Issue öffnen
          </a>
        ) : (
          <p className="text-slate-500">Noch nicht extern abgelegt.</p>
        )}
        {!canSyncExistingGitHubIssue && <p className="text-xs text-slate-500">Nutze „Issue anlegen“ nur, wenn diese Aufgabe bewusst extern gespiegelt werden soll.</p>}
        <details className="mt-1 rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
          <summary className="cursor-pointer list-none text-xs font-semibold text-slate-500">Ablagedetails anzeigen</summary>
          <div className="mt-2 grid gap-1 text-xs text-slate-500">
            <p className="break-words">Repository: {githubState.githubRepo || "findmydoc-platform/management"}</p>
            {githubState.githubLastSyncedAt && <p>Zuletzt gespiegelt: {githubState.githubLastSyncedAt}</p>}
            {githubState.githubSyncError && <p className="flex gap-2 text-red-700"><MessageSquareWarning size={16} />{githubState.githubSyncError}</p>}
          </div>
        </details>
      </div>
    </section>
  );
}
