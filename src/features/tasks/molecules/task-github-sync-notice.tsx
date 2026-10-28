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
    const heading = unknown ? "GitHub-Abgleich unklar" : view.phase === "partiallyConfirmed" ? "GitHub-Abgleich teilweise bestätigt" : view.phase === "blocked" ? "GitHub-Abgleich wartet" : view.phase === "locked" ? "GitHub-Abgleich läuft bereits" : view.phase === "confirmed" ? `Mit GitHub abgeglichen. ${view.checking ? "Aufgabe wird geprüft." : "Aufgabe noch nicht aktualisiert."}` : "GitHub-Abgleich prüfen";
    return <UiNotice role="status" tone={unknown || view.phase === "confirmed" ? "info" : "warning"} className="my-3 min-w-0 [overflow-wrap:anywhere]">
    <h2 className="font-semibold">{heading}</h2>
    {unknown ? <p className="mt-2">Ob der GitHub-Abgleich abgeschlossen ist, ist noch unklar. Prüfe den aktuellen Stand. Der Abgleich wird nicht automatisch wiederholt.</p> : null}
    {view.error ? <p className="mt-2">{view.error}</p> : null}
    {view.submitted ? <details className="mt-2"><summary className="cursor-pointer py-3 font-semibold">Auftrag anzeigen</summary><p>{view.submitted.task.title}</p><p>{view.submitted.command.createIfMissing ? "GitHub Issue anlegen" : "Mit GitHub synchronisieren"}</p></details> : null}
    {view.serverTask ? <p className="mt-2">Geladener Aufgabenstand: {view.serverTask.title} · {view.serverTask.githubIssueSyncStatus === "synced" ? "mit GitHub abgeglichen" : view.serverTask.githubIssueSyncStatus === "failed" ? "Abgleich fehlgeschlagen" : "Abgleich offen"}</p> : null}
    {unknown && view.taskReadStatus === "current" ? <p className="mt-2">Aufgabe geladen. Ob der GitHub-Abgleich vollständig erfolgt ist, bleibt unklar.</p> : null}
    {view.taskReadStatus === "unavailable" ? <p className="mt-2">Der Aufgabenstand konnte nicht vollständig geprüft werden. Bestätigte Ergebnisse bleiben erhalten.</p> : null}
    <div className="mt-3 flex flex-wrap gap-2"><UiButton size="lg" disabled={view.checking} onClick={onCheck}>{view.checking ? "Stand wird geprüft …" : "Aktuellen Stand prüfen"}</UiButton>{view.retryAllowed && onRetry ? <UiButton size="lg" onClick={onRetry}>Erneut versuchen</UiButton> : null}</div>
  </UiNotice>;
}
