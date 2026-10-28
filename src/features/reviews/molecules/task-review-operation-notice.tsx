"use client";

import type { TaskReviewOperation } from "../model/planning-task-review";
import { reviewDecisionLabels } from "../model/task-review-state";
import { UiButton, UiNotice } from "@/shared/atoms/ui-primitives";
import type { Profile } from "@/lib/types";

const labels = { approval:"Freigabe",request:"Review-Anfrage",decision:"Review-Entscheidung",withdraw:"Review zurückziehen",reopen:"Review erneut öffnen" };
export function TaskReviewOperationNotice({operation,onCheck,profiles=[]}:{operation:TaskReviewOperation;onCheck:(id:string)=>void;profiles?:readonly Pick<Profile,"id"|"name">[]}) {
 if(operation.phase==="confirmed")return null;
 const command=operation.submitted?.command;
 const values=command?.kind==="approval"?[["Entscheidung",command.action==="approve"?"Freigeben":"Zur Überarbeitung"],["Begründung",command.note]]:command?.kind==="decision"?[["Entscheidung",reviewDecisionLabels[command.input.decision]],["Punkte",String(command.input.points)],["Kommentar",command.input.comment||""]]:command?.kind==="withdraw"?[["Begründung",command.reason]]:command?.kind==="reopen"?[["Nachweis",command.input.evidenceLink||""],["Ergebnis ohne Link",command.input.evidenceExceptionNote||""]]:command?.kind==="request"?[["Review-Verantwortung",command.input.reviewOwnerProfileId?profiles.find(profile=>profile.id===command.input.reviewOwnerProfileId)?.name||"Person nicht verfügbar":"Nicht gesetzt"],["Nachweis",command.input.evidenceLinks?.join("\n")||""],["Ergebnis ohne Link",command.input.reviewEvidenceExceptionNote||""]]:[];
 const unknown=operation.phase==="unconfirmed";
 const unknownMessages = {
  approval: "Ob die Freigabeentscheidung gespeichert wurde, ist noch unklar.",
  request: "Ob die Review-Anfrage gespeichert wurde, ist noch unklar.",
  decision: "Ob die Review-Entscheidung gespeichert wurde, ist noch unklar.",
  withdraw: "Ob das Review zurückgezogen wurde, ist noch unklar.",
  reopen: "Ob das Review erneut geöffnet wurde, ist noch unklar.",
 };
 return <UiNotice role="status" tone={unknown||operation.phase==="saving"?"info":"warning"} className="my-4 min-w-0 [overflow-wrap:anywhere]">
  <h2 className="font-semibold">{labels[operation.kind]}: {unknown?"Ergebnis unklar":operation.phase==="saving"?"wird gespeichert":operation.phase==="conflict"?"Stand wurde geändert":operation.phase==="blocked"?"noch nicht gesendet":"nicht gespeichert"}</h2>
  {unknown?<p className="mt-2">{unknownMessages[operation.kind]} Deine Eingaben bleiben erhalten. Prüfen lädt nur die aktuellen Daten.</p>:operation.error?<p className="mt-2">{operation.error}</p>:null}
  {operation.submitted?<details className="mt-2"><summary className="cursor-pointer py-3 font-semibold">Eingaben anzeigen</summary><p className="font-medium">{operation.submitted.task.title}</p><dl className="mt-2 space-y-2 whitespace-pre-wrap">{values.filter(([,value])=>value).map(([label,value])=><div key={label}><dt className="font-semibold">{label}</dt><dd>{value}</dd></div>)}</dl></details>:null}
  {operation.serverTask?<dl className="mt-3 space-y-1"><dt className="font-semibold">Aktueller Stand</dt><dd>{operation.serverTask.title}</dd><dd>Status: {operation.serverTask.status}</dd></dl>:null}
  {operation.readStatus==="current"?<p className="mt-2">Aufgabe geladen. {unknown ? "Ob die Änderung vollständig gespeichert wurde, bleibt unklar." : "Vergleiche die Angaben vor dem erneuten Senden."}</p>:operation.readStatus==="unavailable"?<p className="mt-2">Die aktuellen Daten konnten nicht geladen werden. Deine Eingaben bleiben erhalten.</p>:null}
  {["unconfirmed","conflict","blocked"].includes(operation.phase)?<UiButton size="lg" className="mt-3" disabled={operation.checking} onClick={()=>onCheck(operation.id)}>{operation.checking?"Stand wird geprüft …":"Aktuellen Stand prüfen"}</UiButton>:null}
 </UiNotice>;
}
