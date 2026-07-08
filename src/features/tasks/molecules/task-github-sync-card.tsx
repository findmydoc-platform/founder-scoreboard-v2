import { GitBranch, Link2 } from "lucide-react";
import type { Task } from "@/lib/types";

type GitHubSyncState = Pick<Task, "githubRepo" | "githubIssueUrl" | "githubSyncStatus" | "githubLastSyncedAt" | "githubSyncError">;

export function TaskGitHubSyncCard({
  taskType,
  githubState,
  canSyncExistingGitHubIssue,
  pending,
  githubAppConnected,
  onSyncGitHub,
  onCreateGitHubIssue,
}: {
  taskType: Task["taskType"];
  githubState: GitHubSyncState;
  canSyncExistingGitHubIssue: boolean;
  pending: boolean;
  githubAppConnected: boolean;
  onSyncGitHub: () => void;
  onCreateGitHubIssue: () => void;
}) {
  const syncPending = githubState.githubSyncStatus === "pending";
  const hasExternalLink = Boolean(githubState.githubIssueUrl);
  const hasSyncProblem = githubState.githubSyncStatus === "failed" || Boolean(githubState.githubSyncError);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-950">
          <GitBranch size={16} />
          GitHub Issue
        </h2>
        {canSyncExistingGitHubIssue ? (
          <button
            type="button"
            disabled={pending || syncPending || !githubAppConnected}
            onClick={onSyncGitHub}
            className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {syncPending ? "Sync..." : "Sync"}
          </button>
        ) : taskType === "deliverable" ? (
          <button
            type="button"
            disabled={pending || syncPending || !githubAppConnected}
            onClick={onCreateGitHubIssue}
          className="h-8 rounded-md border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
            {syncPending ? "Anlegen..." : "GitHub Issue anlegen"}
          </button>
        ) : null}
      </div>
      <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-600">
        <p className="font-medium text-slate-800">
          {syncPending
            ? "GitHub-Sync läuft."
            : hasSyncProblem
              ? "GitHub-Sync braucht Aufmerksamkeit."
              : hasExternalLink
                ? "Diese Aufgabe ist mit GitHub verknüpft."
                : "Diese Aufgabe hat noch kein GitHub Issue."}
        </p>
        {hasExternalLink ? (
          <a href={githubState.githubIssueUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-blue-700 hover:underline">
            <Link2 size={14} />
            GitHub Issue öffnen
          </a>
        ) : (
          <p className="text-slate-500">Noch kein GitHub Issue.</p>
        )}
        {!canSyncExistingGitHubIssue && <p className="text-xs text-slate-500">GitHub Issue nur bewusst anlegen.</p>}
        {hasSyncProblem && <p className="text-xs font-semibold text-amber-700">Verbindung prüfen und erneut versuchen.</p>}
      </div>
    </section>
  );
}
