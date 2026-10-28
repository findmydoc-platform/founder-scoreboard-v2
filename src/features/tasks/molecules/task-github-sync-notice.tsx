"use client";
import type { TaskGitHubSyncView } from "../model/task-github-sync-state";
import { UiButton, UiNotice } from "@/shared/atoms/ui-primitives";
export function TaskGitHubSyncNotice({ view, onCheck, onRetry }: {
    view: TaskGitHubSyncView;
    onCheck: () => void;
    onRetry?: () => void;
}) {
    if (["ended", "queued", "syncing"].includes(view.phase) || view.phase === "confirmed" && !view.checking && !["stale", "unavailable"].includes(view.taskReadStatus))
        return null;
    const unknown = view.phase === "unconfirmed";
    const heading = unknown ? "GitHub-Sync: Bestätigung ausstehend" : view.phase === "partiallyConfirmed" ? "GitHub-Sync teilweise bestätigt" : view.phase === "blocked" ? "GitHub-Sync wartet" : view.phase === "locked" ? "GitHub-Sync war bereits aktiv" : view.phase === "confirmed" ? "GitHub bestätigt, Aufgabenstand wird geprüft" : "GitHub-Sync braucht Aufmerksamkeit";
    return <UiNotice role="status" tone={unknown || view.phase === "confirmed" ? "info" : "warning"} className="my-3 min-w-0 [overflow-wrap:anywhere]">
    <h2 className="font-semibold">{heading}</h2>
    {unknown ? <p className="mt-2">Die Antwort fehlt. Die Synchronisierung kann bereits erfolgt sein. Prüfe zuerst den aktuellen Stand. Der Sync wird nicht automatisch wiederholt.</p> : null}
    {view.error ? <p className="mt-2">{view.error}</p> : null}
    {view.submitted ? <details className="mt-2"><summary className="cursor-pointer py-3 font-semibold">Vorgang anzeigen</summary><p>{view.submitted.task.title}</p><p>{view.submitted.command.createIfMissing ? "GitHub Issue anlegen" : "Mit GitHub synchronisieren"}</p></details> : null}
    {view.serverTask ? <p className="mt-2">Geladener Aufgabenstand: {view.serverTask.title} · {view.serverTask.githubIssueSyncStatus === "synced" ? "mit GitHub abgeglichen" : view.serverTask.githubIssueSyncStatus === "failed" ? "Sync-Fehler gespeichert" : "Abgleich offen"}</p> : null}
    {unknown && view.taskReadStatus === "current" ? <p className="mt-2">Der geladene Stand beweist den früheren Vorgang und seine weiteren Auswirkungen nicht.</p> : null}
    {view.taskReadStatus === "unavailable" ? <p className="mt-2">Der Aufgabenstand konnte nicht vollständig geprüft werden. Bestätigte Ergebnisse bleiben erhalten.</p> : null}
    <div className="mt-3 flex flex-wrap gap-2"><UiButton size="lg" disabled={view.checking} onClick={onCheck}>{view.checking ? "Stand wird geprüft …" : "Aktuellen Stand prüfen"}</UiButton>{view.retryAllowed && onRetry ? <UiButton size="lg" onClick={onRetry}>Erneut versuchen</UiButton> : null}</div>
  </UiNotice>;
}
