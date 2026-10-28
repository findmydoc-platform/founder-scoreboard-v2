import type { TaskRelationshipChangeView } from "@/features/tasks/model/task-relationship-change";
import { UiButton } from "@/shared/atoms/ui-primitives";
import { relationTypeLabel } from "@/lib/display";
export function TaskRelationshipChangeNotices({ changes, targetOptions, onCheck }: { changes: readonly TaskRelationshipChangeView[]; targetOptions: readonly { value: string; label: string }[]; onCheck?: (id: string) => void }) {
 return <>{changes.filter(view => view.phase !== "confirmed" || Object.values(view.taskReads).some(status => status !== "current")).map(view => <div key={view.id} role="status" className="mt-3 grid gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-800">
  <p className="font-semibold">{view.phase === "saving" ? view.kind === "add" ? "Verknüpfung wird hinzugefügt …" : "Verknüpfung wird entfernt …" : view.phase === "unconfirmed" ? "Ob die Verknüpfung geändert wurde, ist noch unklar. Nicht erneut senden." : view.phase === "rejected" ? "Die Verknüpfung wurde nicht geändert." : `${view.kind === "add" ? "Verknüpfung hinzugefügt." : "Verknüpfung entfernt."} ${view.checking ? "Aufgaben werden geprüft." : "Aufgaben noch nicht vollständig aktualisiert."}`}</p>
  <p className="[overflow-wrap:anywhere]">{relationTypeLabel(view.submitted.relationType)}: {targetOptions.find(option => option.value === view.relatedTaskId)?.label || "Ausgewählte Aufgabe"}</p>
  {view.submitted.note ? <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{view.submitted.note}</p> : null}{view.error ? <p>{view.error}</p> : null}
  {view.phase === "unconfirmed" || view.phase === "confirmed" ? <><p>Prüfen lädt die Aufgaben neu, ohne Verknüpfungen zu ändern.</p>{view.phase === "unconfirmed" && Object.values(view.taskReads).every(status => status === "current") ? <p>Aufgaben geladen. Ob die Verknüpfung geändert wurde, bleibt unklar.</p> : null}{onCheck ? <UiButton className="min-h-11 justify-self-start" disabled={view.checking} onClick={() => onCheck(view.id)}>Verknüpfung prüfen</UiButton> : null}</> : null}
 </div>)}</>;
}
