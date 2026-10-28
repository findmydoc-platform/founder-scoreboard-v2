import type { TaskCommentCreationView } from "@/features/tasks/model/task-comment-creation";
import { UiButton } from "@/shared/atoms/ui-primitives";
export function TaskCommentCreationNotices({ creations, onCheck }: { creations: readonly TaskCommentCreationView[]; onCheck?: (id: string) => void }) {
 return <>{creations.filter(item => item.phase !== "confirmed" || item.notice).map(item => <div key={item.id} role="status" className="mt-3 grid gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-800">
  <p className="font-semibold">{item.phase === "saving" ? "Kommentar wird gespeichert …" : item.phase === "unconfirmed" ? "Kommentarbestätigung fehlt. Nicht erneut senden." : item.phase === "rejected" ? "Kommentar wurde nicht gespeichert." : item.notice?.message}</p>
  {item.phase !== "confirmed" ? <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{item.submitted}</p> : null}
  {item.error ? <p>{item.error}</p> : null}
  {item.phase === "unconfirmed" ? <><p>Prüfen liest die Diskussion; es veröffentlicht keinen Kommentar.</p>{item.checkStatus === "checked" ? <p>Diskussion geprüft. Die ursprüngliche Veröffentlichung bleibt unbestätigt.</p> : null}{onCheck ? <UiButton className="min-h-11 justify-self-start" disabled={item.checkStatus === "checking"} onClick={() => onCheck(item.id)}>Diskussion prüfen</UiButton> : null}</> : null}
 </div>)}</>;
}
