import type { MeetingAttendance, MeetingAttendanceStatus } from "@/lib/types";
import type { MeetingAttendanceEditor } from "@/features/sprint/model/meeting-attendance-state";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { UiButton } from "@/shared/atoms/ui-primitives";
const statusLabels = { pending: "Offen", present: "Anwesend", excused: "Entschuldigt", late_excused: "Spät entschuldigt", unexcused: "Nicht akzeptiert", no_show: "No-Show" };
export function MeetingAttendanceNotice({ editor, onResave }: { editor: MeetingAttendanceEditor; onResave?: () => void }) {
 const view=editor.view();
 if(view.phase==="editing"||view.phase==="ended"||view.phase==="confirmed"&&!view.warning)return null;
 return <div role="status" className="mt-3 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-800">
  <p>{view.phase==="saving"?"Weekly-Rückmeldung wird gespeichert …":view.phase==="loading"?"Weekly-Rückmeldung wird geladen …":view.phase==="unconfirmed"?"Speicherung der Rückmeldung unklar. Nicht erneut senden.":view.phase==="conflict"?"Weekly-Rückmeldung wurde inzwischen geändert. Deine Eingabe bleibt erhalten.":view.warning||view.error}</p>
  {view.submitted?.writtenUpdate&&<p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{view.submitted.writtenUpdate}</p>}
  {view.submitted?.absenceReason&&<p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{view.submitted.absenceReason}</p>}
  {view.phase==="unconfirmed"&&<><UiButton className="min-h-11 justify-self-start" disabled={view.checking} onClick={()=>void editor.checkOutcome()}>Aktuellen Stand prüfen</UiButton>{view.readStatus==="current"&&<p>Rückmeldung geprüft. Ob sie gespeichert wurde, bleibt unklar.</p>}</>}
  {view.phase==="conflict"&&<><UiButton className="min-h-11 justify-self-start" disabled={view.checking} onClick={()=>void editor.refreshConflict()}>Änderungen vergleichen</UiButton>{view.compared&&<p>Aktuell gespeichert: {view.serverRecord?.writtenUpdate||view.serverRecord?.absenceReason||"Keine Rückmeldung"}</p>}{onResave&&<UiButton className="min-h-11 justify-self-start" disabled={!view.compared||view.checking} onClick={onResave}>Erneut speichern</UiButton>}</>}
 </div>;
}
export function MeetingAttendanceEditorForm({ draft, onDraftChange, editor, canEdit, canScore }: { draft: MeetingAttendance; onDraftChange(patch: Partial<MeetingAttendance>): void; editor: MeetingAttendanceEditor; canEdit: boolean; canScore: boolean }) {
 const view=editor.view(),busy=["loading","saving","unconfirmed","ended"].includes(view.phase),patch=()=>({status:draft.status,absenceReason:draft.absenceReason,writtenUpdate:draft.writtenUpdate,reasonAccepted:draft.reasonAccepted,points:draft.points});
 const statuses=(canScore?Object.keys(statusLabels):["pending","excused","late_excused"]) as MeetingAttendanceStatus[];
 return <form aria-label="Weekly-Rückmeldung bearbeiten" className="grid gap-3 rounded-md border border-slate-200 bg-slate-50 p-3 sm:grid-cols-2" onSubmit={event=>{event.preventDefault();void editor.save(patch());}}>
  <label className="grid gap-1 text-xs font-semibold text-slate-600">Status<CustomSelect value={draft.status} disabled={busy||!canEdit} onChange={status=>onDraftChange({status:status as MeetingAttendanceStatus,reasonAccepted:false,points:canScore?draft.points:0})} className="h-11 sm:h-9" options={statuses.map(value=>({value,label:statusLabels[value]}))}/></label>
  <label className="grid gap-1 text-xs font-semibold text-slate-600">Punkte<CustomSelect value={draft.points} disabled={busy||!canScore} onChange={points=>onDraftChange({points:Number(points)})} className="h-11 sm:h-9" options={[0,1,2].map(value=>({value:String(value),label:String(value)}))}/></label>
  <label className="grid gap-1 text-xs font-semibold text-slate-600 sm:col-span-2">Triftiger Grund<input value={draft.absenceReason} disabled={busy||!canEdit} onChange={event=>onDraftChange({absenceReason:event.target.value})} className="h-11 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-800" placeholder="z. B. Krankheit, Familie, nicht verschiebbar"/></label>
  <label className="grid gap-1 text-xs font-semibold text-slate-600 sm:col-span-2">Update<textarea value={draft.writtenUpdate} disabled={busy||!canEdit} onChange={event=>onDraftChange({writtenUpdate:event.target.value})} className="min-h-24 rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-800" placeholder="Kurzupdate, Blocker, nächster Schritt"/></label>
  <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-slate-600"><input type="checkbox" checked={draft.reasonAccepted} disabled={busy||!canScore} onChange={event=>onDraftChange({reasonAccepted:event.target.checked})}/>Grund akzeptiert</label>
  <UiButton type="submit" variant="primary" className="min-h-11 justify-self-start sm:justify-self-end" disabled={busy||view.phase==="conflict"||!canEdit}>Rückmeldung speichern</UiButton>
  <div className="sm:col-span-2"><MeetingAttendanceNotice editor={editor} onResave={()=>void editor.resave(patch())}/></div>
 </form>;
}
