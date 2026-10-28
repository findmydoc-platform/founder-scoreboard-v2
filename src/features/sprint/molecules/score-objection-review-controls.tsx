"use client";

import { useEffect, useMemo, useState } from "react";
import type { FounderSprintScore, Profile, ScoreObjection, ScoreObjectionResolutionInput } from "@/lib/types";
import type { PlanningState } from "@/features/planning/model/planning-state";
import type { ScoreObjectionEditor } from "../model/score-objection-state";
import { ScoreObjectionOperationStatus } from "./score-objection-operation-status";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { UiButton, UiTextArea, UiTextInput } from "@/shared/atoms/ui-primitives";

export function ScoreObjectionReviewControls({
  objection,
  currentProfile,
  profiles,
  currentScore,
  pending,
  planningState,
  scoreComplete,
}: {
  objection: ScoreObjection;
  currentProfile: Profile | null;
  profiles: Profile[];
  currentScore: FounderSprintScore | null;
  scoreComplete: boolean;
  planningState: PlanningState;
  pending: boolean;
}) {
  const retained=planningState.scoreObjectionOperations(objection.sprintId).findLast(view=>view.objectionId===objection.id&&(["saving","unconfirmed","conflict","blocked"].includes(view.phase)||view.phase==="saved"&&Boolean(view.error)));
  const [editor,setEditor]=useState<ScoreObjectionEditor|null>(()=>retained?planningState.resumeScoreObjectionReview(retained.id):null);
  useEffect(()=>()=>editor?.close(),[editor]);
  const submitted=retained?.submitted && ("action" in retained.submitted) ? retained.submitted : null;
  const [draft,setDraft]=useState<{resolutionComment:string;deliveryPoints:number;formPoints:number;weeklyPoints:number;secondReviewerProfileId:string;secondReviewDecision:string}|null>(()=>submitted?{resolutionComment:submitted.resolutionComment||"",deliveryPoints:submitted.deliveryPoints??currentScore?.deliveryPoints??0,formPoints:submitted.formPoints??currentScore?.formPoints??0,weeklyPoints:submitted.weeklyPoints??currentScore?.weeklyPoints??0,secondReviewerProfileId:submitted.secondReviewerProfileId||objection.secondReviewerProfileId||"",secondReviewDecision:submitted.secondReviewDecision||""}:null);
  const values=draft||{resolutionComment:"",deliveryPoints:currentScore?.deliveryPoints??0,formPoints:currentScore?.formPoints??0,weeklyPoints:currentScore?.weeklyPoints??0,secondReviewerProfileId:objection.secondReviewerProfileId||"",secondReviewDecision:""};
  const {resolutionComment,deliveryPoints,formPoints,weeklyPoints,secondReviewerProfileId,secondReviewDecision}=values;
  const begin=()=>{const next=editor||planningState.beginScoreObjectionReview(objection,currentScore);if(!editor){setEditor(next);setDraft(values);}return next;};
  const change=(patch:Partial<typeof values>)=>setDraft(previous=>({...previous||values,...patch}));
  const view=retained||editor?.view();
  const disabled=pending||Boolean(view&&["saving","unconfirmed","conflict","blocked","ended"].includes(view.phase));
  const onSubmit=async(input:ScoreObjectionResolutionInput)=>{const result=await begin().submit(input);if(result.ok){setDraft(null);editor?.close();setEditor(null);}};

  const secondReviewerOptions = useMemo(() => profiles
    .filter((profile) => profile.platformRole !== "viewer" && profile.id !== currentProfile?.id && profile.id !== objection.profileId)
    .map((profile) => ({ value: profile.id, label: profile.name })), [currentProfile?.id, objection.profileId, profiles]);

  if (!currentProfile) return null;
  if(objection.status!=="open"&&!view)return null;

  const isCeo = currentProfile.platformRole === "ceo" && objection.status === "open";
  const secondReviewPending = Boolean(objection.secondReviewerProfileId && !objection.secondReviewedAt);
  const isAssignedSecondReviewer = secondReviewPending && objection.secondReviewerProfileId === currentProfile.id;
  const independentReviewRequired = objection.profileId === currentProfile.id;
  const canResolve = isCeo && !secondReviewPending && (!independentReviewRequired || Boolean(objection.secondReviewedAt));

  const submitResolution = (status: "reviewed" | "dismissed" | "accepted") => {
    onSubmit({
      action: "resolve",
      status,
      resolutionComment,
      ...(status === "accepted" ? { deliveryPoints, formPoints, weeklyPoints } : {}),
    });
  };

  return (
    <div className="grid min-w-0 gap-3 border-t border-slate-200 pt-3" onFocusCapture={()=>{begin();}}>
      {view&&<ScoreObjectionOperationStatus profiles={profiles} view={view} check={()=>{void editor?.checkOutcome();}} compare={()=>{void editor?.refreshConflict();}} resave={()=>{if(view.submitted && ("action" in view.submitted))void editor?.resubmit(view.submitted);}}/>}
      {isCeo && !objection.secondReviewedAt ? (
        <div className="grid gap-2 rounded-md border border-slate-200 bg-white p-3">
          <label className="grid gap-1 text-xs font-semibold text-slate-700">
            Zweitreview zuweisen
            <CustomSelect
              value={secondReviewerProfileId}
              onOpen={()=>{begin();}}
              onChange={value=>change({secondReviewerProfileId:value})}
              disabled={disabled || Boolean(objection.secondReviewedAt)}
              options={[{ value: "", label: "Person auswählen" }, ...secondReviewerOptions]}
              aria-label="Person für Zweitreview auswählen"
            />
          </label>
          <div>
            <UiButton
              disabled={disabled || !secondReviewerProfileId || secondReviewerProfileId === objection.secondReviewerProfileId}
              onClick={() => onSubmit({ action: "assign_second_review", secondReviewerProfileId })}
              size="sm"
              variant="blue"
            >
              {objection.secondReviewerProfileId ? "Zuweisung ändern" : "Zweitreview zuweisen"}
            </UiButton>
          </div>
          {secondReviewPending ? (
            <p className="text-xs text-slate-500">Der Einwand bleibt offen, bis der zugewiesene Zweitreview vorliegt.</p>
          ) : independentReviewRequired ? (
            <p className="text-xs text-slate-500">Ein eigener Einwand des CEO benötigt vor der Entscheidung einen unabhängigen Zweitreview.</p>
          ) : null}
        </div>
      ) : null}

      {isAssignedSecondReviewer ? (
        <div className="grid gap-2">
          <UiTextArea
            disabled={disabled}
            value={secondReviewDecision}
            onChange={(event) => change({secondReviewDecision:event.target.value})}
            minHeight="sm"
            placeholder="Unabhängige Einschätzung dokumentieren"
            aria-label="Zweitreview-Entscheidung"
          />
          <div>
            <UiButton
              disabled={disabled || !secondReviewDecision.trim()}
              onClick={() => onSubmit({ action: "second_review", secondReviewDecision })}
              variant="blue"
              size="sm"
            >
              Zweitreview einreichen
            </UiButton>
          </div>
        </div>
      ) : null}

      {canResolve ? (
        <div className="grid gap-2">
          <UiTextArea
            disabled={disabled}
            value={resolutionComment}
            onChange={(event) => change({resolutionComment:event.target.value})}
            minHeight="sm"
            placeholder="Finale Entscheidung sachlich begründen"
            aria-label="Begründung zur Einwand-Entscheidung"
          />
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="grid gap-1 text-xs font-medium text-slate-600">
              Delivery (0–12)
              <UiTextInput disabled={disabled} className="min-w-0" type="number" min={0} max={12} value={deliveryPoints} onChange={(event) => change({deliveryPoints:Number(event.target.value)})} aria-label="Korrigierte Delivery-Punkte" />
            </label>
            <label className="grid gap-1 text-xs font-medium text-slate-600">
              Form / Review-Reife (0–4)
              <UiTextInput disabled={disabled} className="min-w-0" type="number" min={0} max={4} value={formPoints} onChange={(event) => change({formPoints:Number(event.target.value)})} aria-label="Korrigierte Form-Punkte" />
            </label>
            <label className="grid gap-1 text-xs font-medium text-slate-600">
              Weekly (0–4)
              <UiTextInput disabled={disabled} className="min-w-0" type="number" min={0} max={4} value={weeklyPoints} onChange={(event) => change({weeklyPoints:Number(event.target.value)})} aria-label="Korrigierte Weekly-Punkte" />
            </label>
          </div>
          {!scoreComplete&&<p className="text-xs text-slate-700">Lade den vollständigen Score, bevor du ihn korrigierst.</p>}
          <div className="flex flex-wrap gap-2">
            <UiButton disabled={disabled || !resolutionComment.trim()} onClick={() => submitResolution("reviewed")} variant="blue" size="sm">Geprüft</UiButton>
            <UiButton disabled={disabled || !resolutionComment.trim()} onClick={() => submitResolution("dismissed")} variant="amber" size="sm">Ablehnen</UiButton>
            <UiButton disabled={disabled || !scoreComplete || !resolutionComment.trim()} onClick={() => submitResolution("accepted")} variant="emerald" size="sm">Annehmen & Score aktualisieren</UiButton>
          </div>
        </div>
      ) : null}

      {objection.status==="open" && !isCeo && !isAssignedSecondReviewer ? (
        <p className="text-xs text-slate-500">Der Einwand wartet auf die Entscheidung des CEO.</p>
      ) : null}
    </div>
  );
}
