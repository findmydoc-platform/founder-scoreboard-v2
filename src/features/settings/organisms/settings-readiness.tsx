"use client";

import { taskOwnerLabel } from "@/lib/display";
import { hasGitHubIssue, syncLabel } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import type { Task } from "@/lib/types";
import { UiBadge, UiButton, UiEmptyState, UiNotice, UiPanel } from "@/shared/atoms/ui-primitives";

export function SystemStatusSection({
  source,
  authAvailable,
  authUserEmail,
  githubProviderTokenAvailable,
  googleChatReady,
}: {
  source: "seed" | "supabase";
  authAvailable: boolean;
  authUserEmail: string;
  githubProviderTokenAvailable: boolean;
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
          <span className="text-slate-500">GitHub-Verbindung</span>
          <span className={`min-w-0 whitespace-normal break-words font-semibold ${githubProviderTokenAvailable ? "text-emerald-700" : "text-amber-700"}`}>
            {githubProviderTokenAvailable ? "verbunden" : "neu anmelden nötig"}
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
  githubProviderTokenAvailable,
  onSyncLinkedGitHubTasks,
  onCreateGitHubIssue,
}: {
  tasks: Task[];
  pending: boolean;
  githubProviderTokenAvailable: boolean;
  onSyncLinkedGitHubTasks: () => void;
  onCreateGitHubIssue: (task: Task) => void;
}) {
  const githubCreatableTasks = tasks.filter((task) => task.taskType === "deliverable");
  const linkedSyncQueue = githubCreatableTasks.filter((task) => hasGitHubIssue(task) && task.githubSyncStatus !== "synced");
  const failedSyncTasks = githubCreatableTasks.filter((task) => task.githubSyncStatus === "failed");
  const appOnlyTasks = githubCreatableTasks.filter((task) => !hasGitHubIssue(task));
  const appOnlyPreviewTasks = appOnlyTasks.slice(0, 12);

  return (
    <UiPanel className="min-w-0 xl:col-span-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Externe Ablage</h2>
          <p className="mt-1 text-sm text-slate-500">
            App bleibt führend. Verknüpfte Issues werden aktualisiert; Aufgaben ohne Issue bleiben in der App und können später bewusst extern angelegt werden.
          </p>
        </div>
        <UiButton
          disabled={pending || !linkedSyncQueue.length || !githubProviderTokenAvailable}
          onClick={onSyncLinkedGitHubTasks}
          className="w-full sm:w-auto"
        >
          Verknüpfte Issues aktualisieren
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
            <h3 className="text-sm font-semibold text-slate-950">Verknüpfte Issues</h3>
            <UiBadge tone="white" bordered={false}>{linkedSyncQueue.length}</UiBadge>
          </div>
          <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto pr-1">
            {linkedSyncQueue.slice(0, 8).map((task) => (
              <div key={task.id} className="min-w-0 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
                <div className="line-clamp-1 font-semibold text-slate-900">{task.title}</div>
                <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                  <span>{task.githubIssueNumber ? `#${task.githubIssueNumber}` : "Legacy-Link"}</span>
                  <span>{syncLabel(task.githubSyncStatus)}</span>
                </div>
                {task.githubSyncError && <div className="mt-1 line-clamp-2 text-xs text-red-700">{task.githubSyncError}</div>}
              </div>
            ))}
            {!linkedSyncQueue.length && <UiEmptyState>Keine verknüpften Issues warten auf Aktualisierung.</UiEmptyState>}
          </div>
        </div>
        <div className="rounded-lg border border-amber-100 bg-amber-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-amber-950">Nur in der App</h3>
            <UiBadge tone="amberWhite" bordered={false}>{appOnlyTasks.length}</UiBadge>
          </div>
          <p className="mt-1 text-xs leading-5 text-amber-800">
            Diese Liste bleibt dauerhaft erhalten. Deliverables bleiben in der App, bis sie bewusst extern gespiegelt werden.
          </p>
          <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto pr-1">
            {appOnlyPreviewTasks.map((task) => (
              <div key={task.id} className="min-w-0 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="line-clamp-1 font-semibold text-slate-900">{task.title}</div>
                    <div className="mt-1 flex flex-wrap gap-1 text-xs text-slate-500">
                      <span>{taskOwnerLabel(task)}</span>
                      <span>·</span>
                      <span>{normalizeStatus(task.status)}</span>
                      <span>·</span>
                      <span>{task.priority}</span>
                      <span>·</span>
                      <span>{task.hours}h</span>
                    </div>
                  </div>
                  <UiButton
                    disabled={pending || task.githubSyncStatus === "pending" || !githubProviderTokenAvailable}
                    onClick={() => onCreateGitHubIssue(task)}
                    variant="amber"
                    size="compact"
                    className="w-full shrink-0 text-amber-800 sm:w-auto"
                  >
                    Issue anlegen
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

const setupChecks = [
  "Teamdaten-Projekt verbunden",
  "Beispieldaten bei Bedarf geladen",
  "App-Konfiguration gesetzt",
  "Datenprüfung erfolgreich",
  "Teamzugänge angelegt",
  "Teamprofile mit Anmeldung verbunden",
  "Anmeldeprüfung erfolgreich",
  "Geschützter Zugriff aktiviert",
  "Benachrichtigungszustellung vorbereitet",
  "Sprint-Übertrag vorbereitet",
  "Betriebsprüfung meldet bereit",
];

const productionReadinessItems = [
  {
    title: "Release-Prüfung",
    description: "Build- und Release-Prüfung müssen vor jeder Veröffentlichung erfolgreich sein.",
    status: "bereit",
  },
  {
    title: "GitHub-Zugriff",
    description: "Kommentare, Anhänge und Spiegelung laufen über den angemeldeten GitHub-Nutzer.",
    status: "bereit",
  },
  {
    title: "Deployment-Automation",
    description: "Noch offen: Veröffentlichungsablauf und Umgebungen final prüfen.",
    status: "manuell offen",
  },
  {
    title: "Anmelde-Weiterleitungen",
    description: "Nach Domain-Cutover die Produktionsadresse für Anmeldung und Rückleitung eintragen.",
    status: "nach Domain",
  },
  {
    title: "Chat-Zustellung",
    description: "Operative Hinweise bleiben in der App, bis externe Zustellung bewusst aktiviert wird.",
    status: "vorbereitet",
  },
  {
    title: "Wartung",
    description: "Abhängigkeiten und Sicherheitsmeldungen werden separat geprüft; lokale Audits bleiben Teil der Veröffentlichung.",
    status: "aktiv",
  },
];

export function ProductionReadinessSection() {
  return (
    <UiPanel className="min-w-0 xl:col-span-2">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3">
          <span>
            <span className="block text-base font-semibold text-slate-950">Betriebsdetails</span>
            <span className="mt-1 block text-sm text-slate-500">Für Admins: Release- und Veröffentlichungsstatus anzeigen.</span>
          </span>
          <UiBadge tone="amber">
            manuell offen
          </UiBadge>
        </summary>
        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
          {productionReadinessItems.map((item) => {
            const blocked = item.status === "manuell offen";
            return (
              <div key={item.title} className={`rounded-lg border p-3 text-sm ${blocked ? "border-amber-200 bg-amber-50" : "border-slate-100 bg-slate-50"}`}>
                <div className="flex items-start justify-between gap-3">
                  <h3 className={`font-semibold ${blocked ? "text-amber-950" : "text-slate-950"}`}>{item.title}</h3>
                  <UiBadge tone={blocked ? "amberWhite" : "emeraldWhite"} size="xs" className="shrink-0">
                    {item.status}
                  </UiBadge>
                </div>
                <p className={`mt-2 break-words leading-5 ${blocked ? "text-amber-800" : "text-slate-600"}`}>{item.description}</p>
              </div>
            );
          })}
        </div>
        <UiNotice className="mt-4 break-words">
          Nächster Veröffentlichungsschritt: Deployment-Automation mit den hinterlegten Zugangsdaten ausführen.
        </UiNotice>
      </details>
    </UiPanel>
  );
}

export function SetupChecklistSection() {
  return (
    <UiPanel className="min-w-0">
      <details className="group">
        <summary className="cursor-pointer list-none">
          <span className="block text-base font-semibold text-slate-950">Setup-Schritte</span>
          <span className="mt-1 block text-sm text-slate-500">Nur für Admins anzeigen.</span>
        </summary>
        <div className="mt-4 grid gap-2">
          {setupChecks.map((check, index) => (
            <div key={check} className="flex min-w-0 items-start gap-3 rounded-md border border-slate-100 px-3 py-2 text-sm text-slate-700">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-blue-50 text-xs font-semibold text-blue-700">{index + 1}</span>
              <span className="min-w-0 break-words leading-5">{check}</span>
            </div>
          ))}
        </div>
      </details>
    </UiPanel>
  );
}
