import type { TaskCommentCreationView } from "@/features/tasks/model/task-comment-creation";
import { TaskCommentStatusHelp } from "@/features/tasks/atoms/task-comment-status-help";
import { UiButton } from "@/shared/atoms/ui-primitives";

export function TaskCommentCreationNotices({ creations, onCheck, onRetry }: { creations: readonly TaskCommentCreationView[]; onCheck?: (id: string) => void; onRetry?: (id: string) => void }) {
  return <>{creations.filter(item => item.phase !== "saving" && (item.phase !== "confirmed" || item.notice)).map(item => (
    <div key={item.id} role="status" className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-600">
      <span>{item.phase === "unconfirmed" ? item.checkStatus === "checked" ? "Speicherung weiterhin unklar" : "Speicherung unklar" : item.phase === "rejected" ? "Nicht gespeichert." : "Kommentar gespeichert"}</span>
      <TaskCommentStatusHelp label="Details zur Speicherung">
        {item.phase === "unconfirmed" ? <>
          <p>Nicht erneut senden. Prüfen gleicht die Übermittlung ab und sendet keinen neuen Kommentar.</p>
          {item.checkStatus === "checked" ? <p>Die Prüfung konnte die Speicherung nicht bestätigen.</p> : null}
        </> : item.notice ? <p>{item.notice.message}</p> : <p>Der Kommentar wurde nicht gespeichert. Du kannst ihn erneut versuchen.</p>}
        {item.error ? <p>{item.error}</p> : null}
      </TaskCommentStatusHelp>
      {item.phase === "rejected" && onRetry ? <UiButton onClick={() => onRetry(item.id)}>Erneut versuchen</UiButton> : null}
      {item.phase === "unconfirmed" && onCheck ? <UiButton disabled={item.checkStatus === "checking"} onClick={() => onCheck(item.id)}>Speicherung prüfen</UiButton> : null}
    </div>
  ))}</>;
}
