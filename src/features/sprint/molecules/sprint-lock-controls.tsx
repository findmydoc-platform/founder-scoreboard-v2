"use client";
import {formatDate} from "@/lib/display";
import {useEffect,useId,useRef,useState} from "react";
import type {PlanningState} from "@/features/planning/model/planning-state";
import type {Sprint,Task} from "@/lib/types";
import type {SprintPlanningOptions} from "../model/sprint-planning-options";
import type {SprintLockEditor} from "../model/sprint-lock";
import {UiButton,UiNotice} from "@/shared/atoms/ui-primitives";
export function SprintLockControls({planningState,sprint,tasks,options,disabled,title}:{planningState:PlanningState;sprint:Sprint;tasks:readonly Task[];options:SprintPlanningOptions;disabled:boolean;title?:string}){
 const panelId=useId();
 const [editor,setEditor]=useState<SprintLockEditor|null>(()=>planningState.resumeSprintLock(sprint.id));
 const [opened,setOpened]=useState(false);
 const [message,setMessage]=useState("");
 const [membersShown,setMembersShown]=useState(false);
 const demand=useRef<AbortController|null>(null);
 const subject=useRef<HTMLDivElement|null>(null);
 const opener=useRef<HTMLDivElement|null>(null);
 const view=editor?.view();
 const completion=planningState.sprintCompletion(sprint.id);
 const scoped=completion!==undefined;
 useEffect(()=>()=>editor?.close(),[editor]);
 useEffect(()=>{
  if(!opened||!scoped)return;
  const controller=new AbortController();
  demand.current=controller;
  const signal=controller.signal;
  void planningState.loadSprintCompletion(sprint.id,{refresh:true,signal});
  const observe=()=>{if(document.visibilityState==="visible")void planningState.checkSprintCompletion(sprint.id,{signal});};
  const timer=window.setInterval(observe,60_000);
  document.addEventListener("visibilitychange",observe);
  window.addEventListener("online",observe);
  return ()=>{
   controller.abort();
   if(demand.current===controller)demand.current=null;
   window.clearInterval(timer);
   document.removeEventListener("visibilitychange",observe);
   window.removeEventListener("online",observe);
  };
 },[opened,planningState,scoped,sprint.id]);
 async function lock(conscious=false){
  setMessage("");
  const revision=completion?.readStatus==="current"?completion.revision:undefined;
  const active=conscious&&editor?editor:planningState.beginSprintLock(sprint,tasks,revision);
  setEditor(active);
  const result=await(conscious?active.relock(options):active.lock(options));
  setMessage(result.ok?"":result.error);
  if(result.ok)setOpened(false);
 }
 function open() {
  if(!scoped){void lock();return;}
  setOpened(true);
  window.requestAnimationFrame(()=>subject.current?.focus());
 }
 function close() {
  setOpened(false);
  setMembersShown(false);
  opener.current?.querySelector("button")?.focus();
 }
 const waiting=Boolean(view&&["saving","unconfirmed","blocked","conflict","locked"].includes(view.phase));
 const ready=completion?.readStatus==="current"&&!completion.blockedReason;
 const readStatus=completion?.readStatus;
 const reason=completion?.readStatus==="current"?completion.blockedReason:undefined;
 const notice=readStatus==="forbidden"?"Keine Berechtigung für den Sprint-Abschluss."
  :readStatus==="unavailable"?"Die Abschlussgrundlage konnte nicht vollständig geprüft werden."
  :readStatus==="stale"?"Die Abschlussgrundlage hat sich geändert. Prüfe den aktuellen Stand erneut."
  :reason==="reviewWindow"?"Die Review- und Einwandfrist läuft noch."
  :reason==="objections"?"Offene Score-Einwände blockieren den Abschluss."
  :reason==="alreadyLocked"?"Dieser Sprint ist bereits abgeschlossen."
  :reason==="invalidSchedule"?"Die Zeitgrundlage dieses Sprints ist für den Abschluss unvollständig."
  :readStatus==="not-loaded"?"Die Abschlussgrundlage wurde noch nicht geladen."
  :!ready?"Die Grundlage für den Sprint-Abschluss wird geprüft.":"";
 const retry=readStatus==="not-loaded"||readStatus==="stale"||readStatus==="unavailable"||readStatus==="forbidden"||Boolean(reason&&reason!=="alreadyLocked");
 return <div className="grid min-w-0 gap-3">
 <div ref={opener}><UiButton type="button" className="min-h-11" title={title} disabled={disabled||sprint.scoreLocked||waiting} aria-expanded={scoped?opened&&!waiting:undefined} aria-controls={scoped&&opened&&!waiting?panelId:undefined} onClick={open}>Sprint abschließen</UiButton></div>
 {opened&&!waiting&&scoped?<div id={panelId} ref={subject} tabIndex={-1} role="region" aria-label="Abschlussgrundlage" className="grid min-w-0 gap-3 rounded-lg border border-slate-200 p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">
  <h3 className="text-sm font-semibold text-slate-950">Abschlussgrundlage</h3>
  {notice?<p role="status" className="text-sm text-slate-700">{notice}</p>:null}
  {completion.readStatus==="current"?<div className="grid gap-1 text-sm text-slate-700">
   {reason!=="alreadyLocked"?<p>{completion.basis.tasks.length} {completion.basis.tasks.length===1?"Aufgabe":"Aufgaben"} · {completion.openObjections} {completion.openObjections===1?"offener Score-Einwand":"offene Score-Einwände"}</p>:null}
   {completion.reviewDueAt?<p>Review- und Einwandfrist bis {formatDate(completion.reviewDueAt,{includeYear:true})}</p>:null}
   {ready?<p>{completion.nextSprintId?"Der Folge-Sprint steht fest.":"Es ist noch kein Folge-Sprint vorgesehen."}</p>:null}
   {completion.basis.tasks.length>0&&reason!=="alreadyLocked"?<details onToggle={event=>setMembersShown(event.currentTarget.open)}>
    <summary className="min-h-11 cursor-pointer py-3 font-medium">Einbezogene Aufgaben</summary>
    {membersShown?<ul className="max-h-48 list-disc overflow-y-auto break-words pl-5">{completion.basis.tasks.map(task=><li key={task.id}>{task.title}</li>)}</ul>:null}
   </details>:null}
  </div>:null}
  <div className="flex flex-wrap gap-2">
   <UiButton type="button" className="min-h-11" onClick={close}>Schließen</UiButton>
   {retry?<UiButton type="button" className="min-h-11" onClick={()=>{void planningState.loadSprintCompletion(sprint.id,{refresh:true,signal:demand.current?.signal});}}>Abschlussgrundlage neu laden</UiButton>:null}
   {ready?<UiButton type="button" variant="primary" className="min-h-11" disabled={disabled} onClick={()=>{void lock();}}>Sprint jetzt abschließen</UiButton>:null}
  </div>
 </div>:null}
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
