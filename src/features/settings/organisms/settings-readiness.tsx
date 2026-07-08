"use client";

import { taskAssigneeLabel } from "@/lib/display";
import { hasGitHubIssue } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import type { Task } from "@/lib/types";
import { UiBadge, UiButton, UiEmptyState, UiNotice, UiPanel } from "@/shared/atoms/ui-primitives";

export function SystemStatusSection({
  source,
  authAvailable,
  authUserEmail,
  githubAppConnected,
  googleChatReady,
}: {
  source: "seed" | "supabase";
  authAvailable: boolean;
  authUserEmail: string;
  githubAppConnected: boolean;
  googleChatReady: boolean;
}) {
  return (
    <UiPanel className="min-w-0">
      <h2 className="text-base font-semibold text-slate-950">Arbeitsbereitschaft</h2>
      <div className="mt-4 grid gap-3 text-sm">
        <div className="flex flex-col gap-1 rounded-md bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-slate-500">Arbeitsmodus</span>
          <span className="min-w-0 whitespace-normal break-words font-semibold text-slate-900">{source === "supabase" ? "Teamdaten aktiv" : "Beispieldaten aktiv"}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-md bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-slate-500">Anmeldung</span>
          <span className="min-w-0 whitespace-normal break-words font-semibold text-slate-900 sm:max-w-48 sm:text-right">{authAvailable ? authUserEmail || "Bereit zum Anmelden" : "Nicht eingerichtet"}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-md bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-slate-500">GitHub-App</span>
          <span className={`min-w-0 whitespace-normal break-words font-semibold ${githubAppConnected ? "text-emerald-700" : "text-amber-700"}`}>
            {githubAppConnected ? "verbunden" : "Verbindung nötig"}
          </span>
        </div>
        <div className="flex flex-col gap-1 rounded-md bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-slate-500">Benachrichtigungen</span>
          <span className={`min-w-0 whitespace-normal break-words font-semibold ${googleChatReady ? "text-emerald-700" : "text-amber-700"}`}>
            {googleChatReady ? "Zustellung aktiv" : "In der App gesammelt"}
          </span>
        </div>
      </div>
    </UiPanel>
  );
}

export function GitHubSyncQueueSection({
  tasks,
  pending,
  githubAppConnected,
  onSyncLinkedGitHubTasks,
  onCreateGitHubIssue,
}: {
  tasks: Task[];
  pending: boolean;
  githubAppConnected: boolean;
  onSyncLinkedGitHubTasks: () => void;
  onCreateGitHubIssue: (task: Task) => void;
}) {
  const githubCreatableTasks = tasks.filter((task) => task.taskType === "deliverable");
  const linkedSyncQueue = githubCreatableTasks.filter((task) => hasGitHubIssue(task) && task.githubSyncStatus !== "synced");
  const failedSyncTasks = githubCreatableTasks.filter((task) => task.githubSyncStatus === "failed");
  const appOnlyTasks = githubCreatableTasks.filter((task) => !hasGitHubIssue(task));
  const appOnlyPreviewTasks = appOnlyTasks.slice(0, 12);
  const storageStateLabel = (task: Task) => {
    if (task.githubSyncStatus === "pending") return "Aktualisierung läuft";
    if (task.githubSyncStatus === "failed") return "Aufmerksamkeit nötig";
    return "Aktualisierung offen";
  };

  return (
    <UiPanel className="min-w-0 xl:col-span-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Externe Ablage</h2>
          <p className="mt-1 text-sm text-slate-500">
            Aufgaben bleiben in der App. Ausgewählte Deliverables können zusätzlich extern abgelegt werden.
          </p>
        </div>
        <UiButton
          disabled={pending || !linkedSyncQueue.length || !githubAppConnected}
          onClick={onSyncLinkedGitHubTasks}
          className="w-full sm:w-auto"
        >
          Externe Ablagen aktualisieren
        </UiButton>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="min-w-0 rounded-md bg-slate-50 px-3 py-2 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aktualisierung offen</div>
          <div className="mt-1 text-2xl font-semibold text-slate-950">{linkedSyncQueue.length}</div>
        </div>
        <div className="min-w-0 rounded-md bg-slate-50 px-3 py-2 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fehlgeschlagen</div>
          <div className="mt-1 text-2xl font-semibold text-slate-950">{failedSyncTasks.length}</div>
        </div>
        <div className="min-w-0 rounded-md bg-amber-50 px-3 py-2 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Extern anlegen</div>
          <div className="mt-1 text-2xl font-semibold text-amber-900">{appOnlyTasks.length}</div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-950">Extern abgelegt</h3>
            <UiBadge tone="white" bordered={false}>{linkedSyncQueue.length}</UiBadge>
          </div>
          <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto pr-1">
            {linkedSyncQueue.slice(0, 8).map((task) => (
              <div key={task.id} className="min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
                <div className="line-clamp-1 font-semibold text-slate-900">{task.title}</div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span>{task.githubIssueNumber ? `#${task.githubIssueNumber}` : "Externer Link"}</span>
                  <span>{storageStateLabel(task)}</span>
                </div>
                {task.githubSyncStatus === "failed" && <div className="mt-1 line-clamp-2 text-xs text-red-700">Aktualisierung konnte nicht abgeschlossen werden.</div>}
              </div>
            ))}
            {!linkedSyncQueue.length && <UiEmptyState>Keine extern abgelegten Aufgaben warten auf Aktualisierung.</UiEmptyState>}
          </div>
        </div>
        <div className="rounded-lg border border-amber-100 bg-amber-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-amber-950">Nur in der App</h3>
            <UiBadge tone="amberWhite" bordered={false}>{appOnlyTasks.length}</UiBadge>
          </div>
          <p className="mt-1 text-xs leading-5 text-amber-800">
            Diese Liste bleibt dauerhaft erhalten. Deliverables bleiben in der App, bis sie bewusst extern angelegt werden.
          </p>
          <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto pr-1">
            {appOnlyPreviewTasks.map((task) => (
              <div key={task.id} className="min-w-0 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-1 font-semibold text-slate-900">{task.title}</div>
                    <div className="mt-1 flex flex-wrap gap-1 text-xs text-slate-500">
                      <span>{taskAssigneeLabel(task)}</span>
                      <span>·</span>
                      <span>{normalizeStatus(task.status)}</span>
                      <span>·</span>
                      <span>{task.priority}</span>
                      <span>·</span>
                      <span>{task.hours}h</span>
                    </div>
                  </div>
                  <UiButton
                    disabled={pending || task.githubSyncStatus === "pending" || !githubAppConnected}
                    onClick={() => onCreateGitHubIssue(task)}
                    variant="amber"
                    size="compact"
                    className="w-full shrink-0 text-amber-800 sm:w-auto"
                  >
                    Extern anlegen
                  </UiButton>
                </div>
              </div>
            ))}
            {appOnlyTasks.length > appOnlyPreviewTasks.length && (
              <UiNotice tone="warning" size="xs" className="bg-white text-center font-semibold">
            {appOnlyTasks.length - appOnlyPreviewTasks.length} weitere Aufgaben warten auf externe Anlage.
              </UiNotice>
            )}
            {!appOnlyTasks.length && (
              <UiEmptyState tone="warning" className="bg-white">
                Keine Aufgaben ohne externe Ablage.
              </UiEmptyState>
            )}
          </div>
        </div>
      </div>
    </UiPanel>
  );
}
