"use client";
import {formatDate} from "@/lib/display";
import {useEffect,useState} from "react";
import type {PlanningState} from "@/features/planning/model/planning-state";
import type {Sprint,Task} from "@/lib/types";
import type {SprintPlanningOptions} from "../model/sprint-planning-options";
import type {SprintLockEditor} from "../model/sprint-lock";
import {UiButton,UiNotice} from "@/shared/atoms/ui-primitives";
export function SprintLockControls({planningState,sprint,tasks,options,disabled,title}:{planningState:PlanningState;sprint:Sprint;tasks:readonly Task[];options:SprintPlanningOptions;disabled:boolean;title?:string}){
 const[editor,setEditor]=useState<SprintLockEditor|null>(()=>planningState.resumeSprintLock(sprint.id));const[message,setMessage]=useState("");useEffect(()=>()=>editor?.close(),[editor]);const view=editor?.view();
 async function lock(conscious=false){setMessage("");const active=conscious&&editor?editor:planningState.beginSprintLock(sprint,tasks);setEditor(active);const result=await(conscious?active.relock(options):active.lock(options));setMessage(result.ok?"":result.error);}
 const waiting=Boolean(view&&["saving","unconfirmed","blocked","conflict","locked"].includes(view.phase));
 return <div className="grid min-w-0 gap-3"><UiButton type="button" className="min-h-11" title={title} disabled={disabled||sprint.scoreLocked||waiting} onClick={()=>{void lock();}}>Sprint abschließen</UiButton>
 {view&&view.phase!=="ready"&&view.phase!=="ended"&&<UiNotice tone={view.phase==="locked"?"success":"warning"} role="status">
  <p className="font-semibold">{view.phase==="locked"?"Sprint-Abschluss bestätigt":view.phase==="conflict"?"Sprint vor dem Abschluss prüfen":view.phase==="rejected"?"Sprint-Abschluss abgelehnt":view.phase==="saving"?"Sprint-Abschluss wird gespeichert":"Sprint-Abschluss unklar"}</p>
  {view.receipt&&<p>{view.receipt.carryover?.evaluated!==undefined&&`${view.receipt.carryover.evaluated} Deliverables bewertet. `}{view.receipt.carryover?.created!==undefined&&`${view.receipt.carryover.created} Carry-over-Vorschläge. `}{view.receipt.scoring?.scores!==undefined&&`${view.receipt.scoring.scores} Scores bestätigt.`}</p>}
  {view.phase==="locked"&&view.projectionRead!=="current"&&<p>Sprint abgeschlossen. Ergebnisse noch nicht vollständig geladen.</p>}
  {view.phase==="locked"&&<p className="mt-2 font-semibold">{view.followUp.phase==="confirmed"?"Folgeplanung gespeichert":view.followUp.phase==="failed"?"Folgeplanung fehlgeschlagen":view.followUp.phase==="unconfirmed"?"Speicherung der Folgeplanung unklar":view.followUp.phase==="creating"?"Folgeplanung wird vorbereitet":"Folgeplanung noch nicht gestartet"}</p>}
  {view.followUp.error&&<p>{view.followUp.error}</p>}{view.error&&<p>{view.error}</p>}
  {view.serverBasis&&<div className="mt-2 max-h-48 overflow-y-auto break-words"><p>Aktueller Stand: {view.serverBasis.sprint.name}, {view.serverBasis.tasks.length} Aufgaben</p><p>{formatDate(view.serverBasis.sprint.startDate, {includeYear:true})} bis {formatDate(view.serverBasis.sprint.endDate, {includeYear:true})}</p>{view.serverBasis.tasks.map(task=><p key={task.id}>{task.title}</p>)}</div>}
  <div className="mt-2 flex flex-wrap gap-2">{["unconfirmed","blocked"].includes(view.phase)&&<UiButton className="min-h-11" onClick={async()=>{const checked=await editor?.checkOutcome();setMessage(checked?.outcome==="confirmed"?"Sprint abgeschlossen. Die Prüfung hat nichts erneut gespeichert.":checked?.outcome==="not-pending"?"Der Abschluss wurde noch nicht gesendet. Du kannst den Sprint jetzt abschließen.":"Ob der Sprint abgeschlossen wurde, bleibt unklar. Die Prüfung hat nichts erneut gespeichert.");}}>Abschluss prüfen</UiButton>}
   {view.phase==="conflict"&&<><UiButton className="min-h-11" onClick={async()=>{await editor?.refreshConflict();if(editor?.view().phase==="locked")setMessage("");}}>Sprint vor dem Abschluss prüfen</UiButton><UiButton className="min-h-11" disabled={!view.canRelock} onClick={()=>{void lock(true);}}>Erneut abschließen</UiButton></>}
   {view.phase==="locked"&&["not-started","failed"].includes(view.followUp.phase)&&<UiButton className="min-h-11" onClick={()=>{void editor?.prepareFollowingPlan();}}>Folgeplanung vorbereiten</UiButton>}
   {view.phase==="locked"&&view.followUp.phase==="unconfirmed"&&<UiButton className="min-h-11" onClick={async()=>{await planningState.checkSprintPlan();setMessage("Ob die Folgeplanung gespeichert wurde, bleibt unklar. Es wurde nichts erneut gesendet.");}}>Folgeplanung prüfen</UiButton>}
  </div>
 </UiNotice>}{message&&<p className="text-sm text-slate-700" role="status">{message}</p>}</div>;
}
