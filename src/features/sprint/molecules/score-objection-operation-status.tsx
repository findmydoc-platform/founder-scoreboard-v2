"use client";
import type { ScoreObjectionOperation } from "../model/score-objection-state";
import { scoreObjectionStatusLabels } from "../model/score-objection-state";
import type { Profile } from "@/lib/types";
import { UiButton } from "@/shared/atoms/ui-primitives";
export function ScoreObjectionOperationStatus({view,check,compare,resave,profiles=[]}:{view:ScoreObjectionOperation;profiles?:readonly Profile[];check():void;compare?():void;resave?():void}) {
 const creation=view.objectionId===null;
 return <div role="status" className="grid min-w-0 gap-2 text-sm text-slate-700">
  {view.phase==="saving"&&<p>{creation?"Einwand wird gespeichert":"Entscheidung wird gespeichert"}</p>}
  {view.phase==="saved"&&view.error&&<p>{view.error}</p>}
  {view.phase==="unconfirmed"&&<>
   <p className="font-semibold">{creation?"Speicherung des Einwands unklar":"Speicherung der Entscheidung unklar"}</p><p>{view.error}</p>
   {view.checkStatus==="checking"&&<p>Aktueller Stand wird geprüft.</p>}
   {["current","stale"].includes(view.checkStatus)&&<p>Ob die Änderung vollständig gespeichert wurde, bleibt unklar.</p>}
   {view.checkStatus==="unavailable"&&<p>Aktuelle Daten derzeit nicht verfügbar.</p>}
   {view.checkStatus==="forbidden"&&<p>Kein Zugriff auf die aktuellen Daten.</p>}
   <UiButton className="min-h-11 whitespace-normal" disabled={view.checkStatus==="checking"} onClick={check}>Aktuellen Stand prüfen</UiButton>
  </>}
  {view.phase==="conflict"&&<>
   <p className="font-semibold">Einwand oder Score inzwischen geändert</p><p>{view.error}</p>
   {view.serverObjection&&<p>Aktueller Einwand: {view.serverObjection.comment}</p>}
   {view.serverObjection&&<p>Status: {scoreObjectionStatusLabels[view.serverObjection.status]} · Zweitreview: {view.serverObjection.secondReviewerProfileId ? profiles.find(profile => profile.id === view.serverObjection!.secondReviewerProfileId)?.name || "Person nicht verfügbar" : "Nicht zugewiesen"}</p>}
   {view.serverScore&&<p>Aktueller Score: {view.serverScore.totalPoints}/20</p>}
   <UiButton className="min-h-11 whitespace-normal" onClick={compare}>Änderungen vergleichen</UiButton>
   <UiButton className="min-h-11 whitespace-normal" disabled={!view.canResave} onClick={resave}>Erneut speichern</UiButton>
  </>}
  {["rejected","blocked"].includes(view.phase)&&<p>{view.error}</p>}
 </div>;
}
