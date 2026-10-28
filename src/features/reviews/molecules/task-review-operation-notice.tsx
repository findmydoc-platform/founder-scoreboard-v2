"use client";

import type { TaskReviewOperation } from "../model/planning-task-review";
import { reviewDecisionLabels } from "../model/task-review-state";
import { UiButton, UiNotice } from "@/shared/atoms/ui-primitives";

const labels = { approval:"Freigabe",request:"Review-Anfrage",decision:"Review-Entscheidung",withdraw:"Review zurückziehen",reopen:"Review erneut öffnen" };
export function TaskReviewOperationNotice({operation,onCheck}:{operation:TaskReviewOperation;onCheck:(id:string)=>void}) {
 if(operation.phase==="confirmed")return null;
 const command=operation.submitted?.command;
 const values=command?.kind==="approval"?[["Entscheidung",command.action==="approve"?"Freigeben":"Zur Überarbeitung"],["Begründung",command.note]]:command?.kind==="decision"?[["Entscheidung",reviewDecisionLabels[command.input.decision]],["Punkte",String(command.input.points)],["Kommentar",command.input.comment||""]]:command?.kind==="withdraw"?[["Begründung",command.reason]]:command?.kind==="reopen"?[["Nachweis",command.input.evidenceLink||""],["Ergebnis ohne Link",command.input.evidenceExceptionNote||""]]:command?.kind==="request"?[["Review-Verantwortung",command.input.reviewOwnerProfileId||""],["Nachweis",command.input.evidenceLinks?.join("\n")||""],["Ergebnis ohne Link",command.input.reviewEvidenceExceptionNote||""]]:[];
 const unknown=operation.phase==="unconfirmed";
 return <UiNotice role="status" tone={unknown||operation.phase==="saving"?"info":"warning"} className="my-4 min-w-0 [overflow-wrap:anywhere]">
  <h2 className="font-semibold">{labels[operation.kind]}: {unknown?"Bestätigung ausstehend":operation.phase==="saving"?"wird gespeichert":operation.phase==="conflict"?"Stand wurde geändert":operation.phase==="blocked"?"noch nicht gesendet":"nicht gespeichert"}</h2>
  {unknown?<p className="mt-2">Die Antwort fehlt. Die Entscheidung kann bereits gespeichert sein. Deine Eingaben bleiben erhalten; die Prüfung liest nur den aktuellen Stand.</p>:operation.error?<p className="mt-2">{operation.error}</p>:null}
  {operation.submitted?<details className="mt-2"><summary className="cursor-pointer py-3 font-semibold">Eingaben anzeigen</summary><p className="font-medium">{operation.submitted.task.title}</p><dl className="mt-2 space-y-2 whitespace-pre-wrap">{values.filter(([,value])=>value).map(([label,value])=><div key={label}><dt className="font-semibold">{label}</dt><dd>{value}</dd></div>)}</dl></details>:null}
  {operation.serverTask?<dl className="mt-3 space-y-1"><dt className="font-semibold">Geladener Serverstand</dt><dd>{operation.serverTask.title}</dd><dd>Status: {operation.serverTask.status}</dd><dd>Freigaberevision: {operation.serverTask.approvalRevision}</dd></dl>:null}
  {operation.readStatus==="current"||operation.readStatus==="stale"?<p className="mt-2">Der aktuelle Stand wurde geladen. Das bestätigt den früheren Vorgang und seine weiteren Auswirkungen nicht.</p>:operation.readStatus==="unavailable"?<p className="mt-2">Der aktuelle Stand konnte nicht vollständig geprüft werden. Die Eingaben bleiben erhalten.</p>:null}
  {["unconfirmed","conflict","blocked"].includes(operation.phase)?<UiButton size="lg" className="mt-3" disabled={operation.checking} onClick={()=>onCheck(operation.id)}>{operation.checking?"Stand wird geprüft …":"Aktuellen Stand prüfen"}</UiButton>:null}
 </UiNotice>;
}
