"use client";

import { useEffect, useState } from "react";
import type { PlanningState } from "@/features/planning/model/planning-state";
import type { ScoreObjectionCreationEditor } from "../model/score-objection-state";
import { ScoreObjectionOperationStatus } from "../molecules/score-objection-operation-status";
import { ScoreObjectionReviewControls } from "@/features/sprint/molecules/score-objection-review-controls";
import type { PlanningShellState, Profile, Sprint } from "@/lib/types";
import { sprintObjectionWindowState } from "@/lib/sprint-review-window";
import { UiBadge, UiButton, UiEmptyState, UiPanel, UiTextInput } from "@/shared/atoms/ui-primitives";

export function SprintScoreObjections({data,sprint,currentProfile,pending,planningState}:{
 data:Pick<PlanningShellState,"profiles"|"scoreObjections">;sprint:Sprint;currentProfile:Profile|null;pending:boolean;planningState:PlanningState;
}) {
 const operations=planningState.scoreObjectionOperations(sprint.id);
 const retained=operations.findLast(view=>view.objectionId===null&&view.profileId===currentProfile?.id&&["saving","unconfirmed","blocked"].includes(view.phase));
 const [editor,setEditor]=useState<ScoreObjectionCreationEditor|null>(()=>retained?planningState.resumeScoreObjectionCreation(retained.id):null);
 useEffect(()=>()=>editor?.close(),[editor]);
 const [scoreObjectionDraft,onScoreObjectionDraftChange]=useState(()=>retained?.submitted&&"comment" in retained.submitted?retained.submitted.comment:"");
 const view=retained||editor?.view();
 const disabled=pending||Boolean(view&&["saving","unconfirmed","blocked","ended"].includes(view.phase));
 const openObjectionsCount=data.scoreObjections.filter(item=>item.sprintId===sprint.id&&item.status==="open").length;
 const complete=planningState.sprintWorkspace().model.coverage.objections==="complete";
  const [renderedAt] = useState(() => Date.now());
  const shownObjections=[...new Map([...operations.flatMap(view=>view.originalObjection&&["saving","unconfirmed","conflict","blocked"].includes(view.phase)?[view.originalObjection]:[]),...data.scoreObjections].map(row=>[row.id,row])).values()];
  const objectionWindow = sprintObjectionWindowState(sprint.endDate, sprint.reviewDueAt, new Date(renderedAt));
  return (
    <UiPanel className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Score-Einwände</h2>
          <p className="text-xs text-slate-500">Einwände müssen vor dem Sprint-Lock geprüft sein. Es gibt maximal einen Zweitreview.</p>
        </div>
        <UiBadge tone="white" size="md">{openObjectionsCount} {complete?"offen":"offen geladen"}</UiBadge>
      </div>
      <div className="mt-3 grid gap-2">
        {shownObjections.filter((item) => item.sprintId === sprint.id).map((objection) => {
          const profile = data.profiles.find((item) => item.id === objection.profileId);
          const scoreBasis=planningState.scoreObjectionScore(sprint.id,objection.profileId);
          const reviewer = data.profiles.find((item) => item.id === objection.reviewedBy);
          const secondReviewer = data.profiles.find((item) => item.id === objection.secondReviewerProfileId);
          return (
            <div key={objection.id} className="grid gap-2 rounded-md border border-slate-100 bg-slate-50 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-900">{profile?.name || objection.profileId} · {objection.status}</span>
              </div>
              <p className="text-slate-700">{objection.comment}</p>
              {objection.resolutionComment && (
                <p className="text-xs text-slate-600">Entscheidung {reviewer?.name || objection.reviewedBy}: {objection.resolutionComment}</p>
              )}
              {objection.status === "accepted" && objection.resolvedDeliveryPoints !== null && (
                <p className="text-xs font-medium text-emerald-700">
                  Bestätigte Punkteentscheidung: {objection.resolvedDeliveryPoints + (objection.resolvedFormPoints || 0) + (objection.resolvedWeeklyPoints || 0)}/20
                  {` · Delivery ${objection.resolvedDeliveryPoints}/12 · Form ${objection.resolvedFormPoints || 0}/4 · Weekly ${objection.resolvedWeeklyPoints || 0}/4`}
                </p>
              )}
              {objection.secondReviewerProfileId && (
                <p className="text-xs text-slate-500">
                  Zweitreview {secondReviewer?.name || objection.secondReviewerProfileId}: {objection.secondReviewedAt ? objection.secondReviewDecision : "ausstehend"}
                </p>
              )}
              {currentProfile && (
                <ScoreObjectionReviewControls
                  objection={objection}
                  currentProfile={currentProfile}
                  profiles={data.profiles}
                  planningState={planningState}
                  scoreComplete={scoreBasis.complete}
                  currentScore={scoreBasis.score}
                  pending={pending}
                />
              )}
            </div>
          );
        })}
        {!shownObjections.some((item) => item.sprintId === sprint.id) && <UiEmptyState>Noch keine Score-Einwände.</UiEmptyState>}
      </div>
      {view&&<ScoreObjectionOperationStatus view={view} check={()=>{void editor?.checkOutcome();}}/>}
      {!sprint.scoreLocked && currentProfile && (objectionWindow.open||Boolean(retained)) && (
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={async(event) => {
            event.preventDefault();
            if (!scoreObjectionDraft.trim()) return;
            const next=editor||planningState.beginScoreObjectionCreation(sprint.id,currentProfile.id);setEditor(next);
            const result=await next.submit(scoreObjectionDraft);
            if(result.ok){onScoreObjectionDraftChange("");next.close();setEditor(null);}
          }}
        >
          <UiTextInput
            aria-label="Score-Einwand"
            disabled={disabled}
            value={scoreObjectionDraft}
            onChange={(event) => onScoreObjectionDraftChange(event.target.value)}
            className="flex-1 px-3"
            placeholder="Sachlich begründeten Score-Einwand einreichen"
          />
          <UiButton type="submit" disabled={disabled || !scoreObjectionDraft.trim()}>Einwand speichern</UiButton>
        </form>
      )}
      {!sprint.scoreLocked && currentProfile && !objectionWindow.open ? (
        <p className="mt-3 text-xs text-slate-500">
          {objectionWindow.startsAt && new Date(objectionWindow.startsAt).getTime() >= renderedAt
            ? "Score-Einwände können nach dem Sprint-Ende eingereicht werden."
            : "Die konfigurierte Frist für neue Score-Einwände ist geschlossen."}
        </p>
      ) : null}
    </UiPanel>
  );
}
