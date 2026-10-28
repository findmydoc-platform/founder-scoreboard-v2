import type { TaskAttachmentUploadView } from "@/features/tasks/model/task-attachment-upload";
import { UiButton } from "@/shared/atoms/ui-primitives";
export function TaskAttachmentUploadNotices({ uploads, onCheck }: { uploads: readonly TaskAttachmentUploadView[]; onCheck?: (id: string) => void }) {
 return <>{uploads.map(view => <div key={view.id} role="status" className="mt-3 grid gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-800">
  <p className="font-semibold">{view.phase === "uploading" ? "Anhang wird hochgeladen …" : view.phase === "unconfirmed" ? "Ob der Anhang hochgeladen wurde, ist noch unklar. Nicht erneut hochladen." : view.phase === "rejected" ? "Anhang wurde nicht hochgeladen." : "Anhang hochgeladen."}</p>
  <p className="[overflow-wrap:anywhere]">{view.filename}</p>
  {view.markdown ? <code className="whitespace-pre-wrap [overflow-wrap:anywhere]">{view.markdown}</code> : null}
  {view.error ? <p>{view.error}</p> : null}{view.warning ? <p>{view.warning}</p> : null}
  {view.phase === "unconfirmed" || view.phase === "uploaded" && view.taskReadStatus !== "current" ? <><p>Prüfen lädt Aufgabe und Verlauf neu, ohne die Datei erneut hochzuladen.</p>{view.phase === "unconfirmed" && view.taskReadStatus === "current" ? <p>Aufgabe geladen. Ob der Anhang hochgeladen wurde, bleibt unklar.</p> : null}{onCheck ? <UiButton className="min-h-11 justify-self-start" disabled={view.checking} onClick={() => onCheck(view.id)}>Anhang prüfen</UiButton> : null}</> : null}
 </div>)}</>;
}
