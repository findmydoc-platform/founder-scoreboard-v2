"use client";
import type { ScoreObjectionOperation } from "../model/score-objection-state";
import { UiButton } from "@/shared/atoms/ui-primitives";
export function ScoreObjectionOperationStatus({view,check,compare,resave}:{view:ScoreObjectionOperation;check():void;compare?():void;resave?():void}) {
 const creation=view.objectionId===null;
 return <div role="status" className="grid min-w-0 gap-2 text-sm text-slate-700">
  {view.phase==="saving"&&<p>{creation?"Einwand wird gespeichert":"Entscheidung wird gespeichert"}</p>}
  {view.phase==="saved"&&view.error&&<p>{view.error}</p>}
  {view.phase==="unconfirmed"&&<>
   <p className="font-semibold">{creation?"Einwand noch nicht bestätigt":"Entscheidung noch nicht bestätigt"}</p><p>{view.error}</p>
   {view.checkStatus==="checking"&&<p>Serverstand wird geprüft.</p>}
   {["current","stale"].includes(view.checkStatus)&&<p>Die vollständige Speicherung bleibt unbestätigt.</p>}
   {view.checkStatus==="unavailable"&&<p>Serverstand derzeit nicht verfügbar.</p>}
   {view.checkStatus==="forbidden"&&<p>Keine Berechtigung für den Serverstand.</p>}
   <UiButton className="min-h-11 whitespace-normal" disabled={view.checkStatus==="checking"} onClick={check}>Serverstand prüfen</UiButton>
  </>}
  {view.phase==="conflict"&&<>
   <p className="font-semibold">Entscheidungsgrundlage wurde geändert</p><p>{view.error}</p>
   {view.serverObjection&&<p>Server-Einwand: {view.serverObjection.comment}</p>}
   {view.serverObjection&&<p>Server: {view.serverObjection.status} · Zweitreview {view.serverObjection.secondReviewerProfileId||"nicht zugewiesen"}</p>}
   {view.serverScore&&<p>Gespeicherter Server-Score: {view.serverScore.totalPoints}/20</p>}
   <UiButton className="min-h-11 whitespace-normal" onClick={compare}>Serverstand vergleichen</UiButton>
   <UiButton className="min-h-11 whitespace-normal" disabled={!view.canResave} onClick={resave}>Bewusst erneut speichern</UiButton>
  </>}
  {["rejected","blocked"].includes(view.phase)&&<p>{view.error}</p>}
 </div>;
}
