import type { TaskGitHubImportView } from "@/features/tasks/model/task-github-comment-import";
import { UiButton } from "@/shared/atoms/ui-primitives";
export function TaskGitHubImportNotice({ view, onCheck }: { view?: TaskGitHubImportView | null; onCheck?: () => void }) {
 if (!view || view.phase === "saving" || view.phase === "confirmed" && view.taskReadStatus === "current") return null;
 return <div role="status" className="mt-3 grid gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-800">
  <p className="font-semibold">{view.phase === "unconfirmed" ? "GitHub-Import noch nicht bestätigt. Nicht erneut importieren." : view.phase === "rejected" ? "GitHub-Import wurde nicht angewendet." : view.checking ? "GitHub-Kommentare geladen. Evidence-Stand wird geprüft." : view.taskReadStatus === "unavailable" ? "GitHub-Kommentare geladen. Evidence-Stand konnte nicht geprüft werden." : "GitHub-Kommentare geladen. Evidence-Stand ist noch offen."}</p>
  {view.error ? <p>{view.error}</p> : null}
  {view.phase !== "rejected" ? <><p>Prüfen lädt den aktuellen Stand der Aufgabe und Diskussion. Es startet keinen weiteren Import.</p>{view.phase === "unconfirmed" && view.taskReadStatus === "current" ? <p>Serverstand geprüft. Der ursprüngliche Import bleibt unbestätigt.</p> : null}{onCheck ? <UiButton className="min-h-11 justify-self-start" disabled={view.checking} onClick={onCheck}>Import prüfen</UiButton> : null}</> : null}
 </div>;
}
