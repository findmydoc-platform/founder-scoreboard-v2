import type { TaskRelationshipChangeView } from "@/features/tasks/model/task-relationship-change";
import { UiButton } from "@/shared/atoms/ui-primitives";
import { relationTypeLabel } from "@/lib/display";
export function TaskRelationshipChangeNotices({ changes, onCheck }: { changes: readonly TaskRelationshipChangeView[]; onCheck?: (id: string) => void }) {
 return <>{changes.filter(view => view.phase !== "confirmed" || Object.values(view.taskReads).some(status => status !== "current")).map(view => <div key={view.id} role="status" className="mt-3 grid gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-800">
  <p className="font-semibold">{view.phase === "saving" ? view.kind === "add" ? "Beziehung wird hinzugefügt …" : "Beziehung wird entfernt …" : view.phase === "unconfirmed" ? "Beziehungsänderung noch nicht bestätigt. Nicht erneut senden." : view.phase === "rejected" ? "Beziehungsänderung wurde nicht gespeichert." : "Beziehung bestätigt. Aufgabenstand wird geprüft."}</p>
  <p className="[overflow-wrap:anywhere]">{relationTypeLabel(view.submitted.relationType)}: {view.relatedTaskId}</p>
  {view.submitted.note ? <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{view.submitted.note}</p> : null}{view.error ? <p>{view.error}</p> : null}
  {view.phase === "unconfirmed" || view.phase === "confirmed" ? <><p>Prüfen lädt den ausstehenden Aufgabenstand. Es fügt keine Beziehung hinzu und entfernt keine.</p>{view.phase === "unconfirmed" && Object.values(view.taskReads).every(status => status === "current") ? <p>Serverstand geprüft. Die ursprüngliche Änderung bleibt unbestätigt.</p> : null}{onCheck ? <UiButton className="min-h-11 justify-self-start" disabled={view.checking} onClick={() => onCheck(view.id)}>Beziehung prüfen</UiButton> : null}</> : null}
 </div>)}</>;
}
