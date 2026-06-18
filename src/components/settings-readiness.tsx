"use client";

import { AlertTriangle } from "lucide-react";
import { taskOwnerLabel } from "@/lib/display";
import { hasGitHubIssue, syncLabel } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import type { Task } from "@/lib/types";

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
    <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-slate-950">Systemstatus</h2>
      <div className="mt-4 grid gap-3 text-sm">
        <div className="flex flex-col gap-1 rounded-md bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-slate-500">Datenquelle</span>
          <span className="min-w-0 whitespace-normal break-words font-semibold text-slate-900">{source === "supabase" ? "Supabase" : "Seed-Fallback"}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-md bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-slate-500">Supabase ENV</span>
          <span className="min-w-0 whitespace-normal break-words font-semibold text-slate-900">{authAvailable ? "gesetzt" : "nicht gesetzt"}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-md bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-slate-500">Session</span>
          <span className="min-w-0 whitespace-normal break-words font-semibold text-slate-900 sm:max-w-48 sm:text-right">{authUserEmail || "nicht angemeldet"}</span>
        </div>
        <div className="flex flex-col gap-1 rounded-md bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-slate-500">GitHub User-Token</span>
          <span className={`min-w-0 whitespace-normal break-words font-semibold ${githubProviderTokenAvailable ? "text-emerald-700" : "text-amber-700"}`}>
            {githubProviderTokenAvailable ? "verfügbar" : "neu anmelden nötig"}
          </span>
        </div>
        <div className="flex flex-col gap-1 rounded-md bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="text-slate-500">Google Chat</span>
          <span className={`min-w-0 whitespace-normal break-words font-semibold ${googleChatReady ? "text-emerald-700" : "text-amber-700"}`}>
            {googleChatReady ? "versandbereit" : "nur gesammelt"}
          </span>
        </div>
      </div>
    </section>
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
  const githubCreatableTasks = tasks.filter((task) => task.taskType === "deliverable" || task.taskType === "proposal");
  const linkedSyncQueue = githubCreatableTasks.filter((task) => hasGitHubIssue(task) && task.githubSyncStatus !== "synced");
  const failedSyncTasks = githubCreatableTasks.filter((task) => task.githubSyncStatus === "failed");
  const appOnlyTasks = githubCreatableTasks.filter((task) => !hasGitHubIssue(task));
  const appOnlyPreviewTasks = appOnlyTasks.slice(0, 12);

  return (
    <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-950">GitHub Sync Queue</h2>
          <p className="mt-1 text-sm text-slate-500">
            App bleibt führend. Verknüpfte Issues werden aktualisiert; App-only-Aufgaben bleiben dauerhaft sichtbar und können später bewusst als GitHub-Issue angelegt werden.
          </p>
        </div>
        <button
          type="button"
          disabled={pending || !linkedSyncQueue.length || !githubProviderTokenAvailable}
          onClick={onSyncLinkedGitHubTasks}
          className="h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
        >
          Verknüpfte Issues synchronisieren
        </button>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="min-w-0 rounded-md bg-slate-50 px-3 py-2 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sync offen</div>
          <div className="mt-1 text-2xl font-semibold text-slate-950">{linkedSyncQueue.length}</div>
        </div>
        <div className="min-w-0 rounded-md bg-slate-50 px-3 py-2 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fehlgeschlagen</div>
          <div className="mt-1 text-2xl font-semibold text-slate-950">{failedSyncTasks.length}</div>
        </div>
        <div className="min-w-0 rounded-md bg-amber-50 px-3 py-2 text-sm">
          <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">GitHub anlegen</div>
          <div className="mt-1 text-2xl font-semibold text-amber-900">{appOnlyTasks.length}</div>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-950">Aktualisierbare GitHub-Issues</h3>
            <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-600">{linkedSyncQueue.length}</span>
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
            {!linkedSyncQueue.length && <div className="rounded-md border border-dashed border-slate-200 bg-white px-3 py-4 text-center text-sm text-slate-500">Keine verknüpften Issues warten auf Sync.</div>}
          </div>
        </div>
        <div className="rounded-lg border border-amber-100 bg-amber-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-amber-950">App-only Aufgaben</h3>
            <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-amber-700">{appOnlyTasks.length}</span>
          </div>
          <p className="mt-1 text-xs leading-5 text-amber-800">
            Diese Liste bleibt dauerhaft erhalten. Vorschläge und Deliverables bleiben App-only, bis sie bewusst ins Management-Repo gespiegelt werden.
          </p>
          <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto pr-1">
            {appOnlyPreviewTasks.map((task) => (
              <div key={task.id} className="min-w-0 rounded-md border border-amber-200 bg-white px-3 py-2 text-sm">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-2">
                  <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
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
                  <button
                    type="button"
                    disabled={pending || task.githubSyncStatus === "pending" || !githubProviderTokenAvailable}
                    onClick={() => onCreateGitHubIssue(task)}
                    className="h-7 w-full shrink-0 rounded-md border border-amber-200 bg-amber-50 px-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                  >
                    GitHub-Issue anlegen
                  </button>
                </div>
              </div>
            ))}
            {appOnlyTasks.length > appOnlyPreviewTasks.length && (
              <div className="rounded-md border border-amber-200 bg-white px-3 py-2 text-center text-xs font-semibold text-amber-700">
                {appOnlyTasks.length - appOnlyPreviewTasks.length} weitere App-only Aufgaben warten auf GitHub-Anlage.
              </div>
            )}
            {!appOnlyTasks.length && (
              <div className="rounded-md border border-dashed border-amber-200 bg-white px-3 py-4 text-center text-sm text-amber-700">
                Keine App-only Aufgaben ohne GitHub-Issue.
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

const setupChecks = [
  "Supabase-Projekt angelegt",
  "supabase/seed.sql ausgeführt",
  ".env.local gesetzt",
  "npm run verify:supabase grün",
  "Team-User in Supabase Auth angelegt",
  "profiles.auth_user_id verknüpft",
  "npm run verify:auth grün",
  "REQUIRE_SUPABASE_AUTH=true aktiviert",
  "supabase/0008_google_chat_delivery.sql ausgeführt",
  "supabase/0009_sprint_carryover.sql ausgeführt",
  "Health-Check zeigt status ready",
];

const productionReadinessItems = [
  {
    title: "Release-Gate lokal",
    description: "`npm run build` und `npm run verify:release` müssen vor jedem Deployment grün sein.",
    status: "bereit",
  },
  {
    title: "GitHub OAuth",
    description: "OAuth-App gehört zur Organisation und nutzt den angemeldeten GitHub-User für Kommentare, Anhänge und Sync.",
    status: "bereit",
  },
  {
    title: "GitHub Actions",
    description: "Noch offen: Deploy-Workflows und GitHub Environments prüfen, damit Preview und Production über Actions laufen.",
    status: "manuell offen",
  },
  {
    title: "Supabase Auth Redirects",
    description: "Nach Domain-Cutover die Produktions-URL als Site URL und Redirect URL in Supabase eintragen.",
    status: "nach Domain",
  },
  {
    title: "Google Chat",
    description: "`GOOGLE_CHAT_DELIVERY_ENABLED=false` bleibt sicherer Standard. Operative Event Messages bleiben in der App; Release-Details oder Deployment-Zusammenfassungen gehen nur bewusst über die Pipeline raus.",
    status: "vorbereitet",
  },
  {
    title: "GitHub Maintenance",
    description: "Dependabot ist aktiv. GitHub-Sicherheitsmeldungen werden separat geprüft, lokale Audits bleiben Teil des Release-Gates.",
    status: "aktiv",
  },
];

export function ProductionReadinessSection() {
  return (
    <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Production Readiness</h2>
          <p className="mt-1 text-sm text-slate-500">Aktueller Übergang von lokaler App zu GitHub-Actions-Deployment. GitHub Actions ist der einzige manuelle Blocker.</p>
        </div>
        <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
          GitHub Actions offen
        </span>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        {productionReadinessItems.map((item) => {
          const blocked = item.status === "manuell offen";
          return (
            <div key={item.title} className={`rounded-lg border p-3 text-sm ${blocked ? "border-amber-200 bg-amber-50" : "border-slate-100 bg-slate-50"}`}>
              <div className="flex items-start justify-between gap-3">
                <h3 className={`font-semibold ${blocked ? "text-amber-950" : "text-slate-950"}`}>{item.title}</h3>
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${blocked ? "border-amber-200 bg-white text-amber-700" : "border-emerald-200 bg-white text-emerald-700"}`}>
                  {item.status}
                </span>
              </div>
              <p className={`mt-2 break-words leading-5 ${blocked ? "text-amber-800" : "text-slate-600"}`}>{item.description}</p>
            </div>
          );
        })}
      </div>
      <div className="mt-4 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm leading-6 text-blue-800 break-words">
        Nächster echter Deployment-Schritt: GitHub Actions Workflow mit den Deploy-Secrets ausführen. Danach laufen Env-Pull, Build und Deploy vollständig über Actions.
      </div>
    </section>
  );
}

export function SetupChecklistSection() {
  return (
    <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-base font-semibold text-slate-950">Setup-Checkliste</h2>
      <div className="mt-4 grid gap-2">
        {setupChecks.map((check, index) => (
          <div key={check} className="flex min-w-0 items-start gap-3 rounded-md border border-slate-100 px-3 py-2 text-sm text-slate-700">
            <span className="grid h-6 w-6 place-items-center rounded-md bg-blue-50 text-xs font-semibold text-blue-700">{index + 1}</span>
            <span className="min-w-0 break-words leading-5">{check}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
