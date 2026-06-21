"use client";

import { useState } from "react";
import { dateRange } from "@/lib/display";
import { reviewLabel } from "@/lib/platform";
import { reviewChecklistItems, reviewChecklistScore } from "@/features/sprint/model/sprint-score-view-model";
import type { Task } from "@/lib/types";
import { UiBadge, UiButton, UiLinkButton, UiNotice } from "@/shared/atoms/ui-primitives";

type ReviewChecklist = {
  acceptanceCriteriaMet?: boolean;
  evidenceProvided?: boolean;
  communicationClear?: boolean;
  blockerHandled?: boolean;
};

type Props = {
  task: Task;
  reviewOwnerName: string;
  canReview: boolean;
  canReopen: boolean;
  pending: boolean;
  onReview: (task: Task, reviewStatus: "accepted" | "partial" | "changes_requested", scorePoints: number, checklist: ReviewChecklist, comment: string) => void;
  onReopen: (task: Task) => void;
};

export function TaskReviewSheet({ task, reviewOwnerName, canReview, canReopen, pending, onReview, onReopen }: Props) {
  const [comment, setComment] = useState("");
  const [checklist, setChecklist] = useState<ReviewChecklist>({
    acceptanceCriteriaMet: false,
    evidenceProvided: false,
    communicationClear: false,
    blockerHandled: false,
  });
  const reviewScore = reviewChecklistScore(checklist);
  const final = task.scoreFinal;

  return (
    <section id="accountable-review-sheet" className="scroll-mt-24 overflow-hidden rounded-lg border border-blue-200 bg-white shadow-sm">
      <div className="border-b border-blue-100 bg-blue-50 px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Accountable Review-Blatt</div>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">{task.title}</h2>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <UiBadge tone="white" size="xs">{task.owner}</UiBadge>
              <UiBadge tone="white" size="xs">{task.priority}</UiBadge>
              <UiBadge tone="white" size="xs">{task.hours}h</UiBadge>
              <UiBadge tone="white" size="xs">{dateRange(task)}</UiBadge>
              <UiBadge tone="blue" size="xs">{reviewLabel(task.reviewStatus)}</UiBadge>
              <UiBadge tone="white" size="xs">{reviewOwnerName}</UiBadge>
            </div>
          </div>
          <UiLinkButton href={`/tasks/${encodeURIComponent(task.id)}`} variant="blueOutline" size="sm">
            Aufgabe öffnen
          </UiLinkButton>
        </div>
      </div>
      <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid gap-3">
          <ReviewTextBlock label="Problem Statement" value={task.problemStatement || task.description || "Kein Problem Statement hinterlegt."} />
          <ReviewTextBlock label="Intended Outcome" value={task.intendedOutcome || "Kein Intended Outcome hinterlegt."} />
          <ReviewTextBlock label="Acceptance Criteria" value={task.acceptanceCriteria || task.definitionOfDone || "Keine Acceptance Criteria hinterlegt."} />
          <ReviewTextBlock label="Definition of Done Snapshot" value={task.definitionOfDone || "Keine Definition of Done hinterlegt."} />
          <ReviewTextBlock label="Evidence Required / Abhängigkeiten" value={[task.evidenceRequired || "Kein erwarteter Nachweis hinterlegt.", task.evidenceLink || task.issueUrl || "Noch kein Evidence-Link hinterlegt.", task.dependsOn || "Keine harte Abhängigkeit erfasst."].join("\n")} />
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            disabled={pending || final}
            className="min-h-24 w-full resize-y rounded-md border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-blue-400 disabled:bg-slate-50 disabled:text-slate-500"
            placeholder={final ? "Finale Review ist abgeschlossen." : "Review-Kommentar oder Nacharbeit beschreiben"}
          />
        </div>
        <div className="grid content-start gap-3">
          <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Score</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{final ? task.scorePoints : reviewScore}/10</div>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              {final ? reviewLabel(task.reviewStatus) : "Aus erfüllten Kriterien berechnet."}
            </p>
          </div>
          {final ? (
            <UiNotice tone="success" className="border-emerald-200">
              Diese Review ist abgeschlossen: {task.scorePoints} Punkte · {reviewLabel(task.reviewStatus)}.
            </UiNotice>
          ) : null}
          {reviewChecklistItems.map(([key, label]) => (
            <label key={key} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2 text-sm text-slate-700">
              <span>{label}</span>
              <input
                type="checkbox"
                checked={Boolean(checklist[key as keyof ReviewChecklist])}
                disabled={pending || final}
                onChange={(event) => setChecklist((current) => ({ ...current, [key]: event.target.checked }))}
              />
            </label>
          ))}
          {!final ? (
            <>
              <p className="text-[11px] leading-5 text-slate-500">Nacharbeit öffnet die Aufgabe erneut und setzt 0 Punkte.</p>
              <div className="flex flex-wrap gap-2">
                <UiButton disabled={pending || !canReview} onClick={() => onReview(task, "accepted", reviewScore, checklist, comment)} variant="emerald">Akzeptieren</UiButton>
                <UiButton disabled={pending || !canReview} onClick={() => onReview(task, "partial", reviewScore, checklist, comment)} variant="amber">Teilweise</UiButton>
                <UiButton disabled={pending || !canReview} onClick={() => onReview(task, "changes_requested", 0, checklist, comment)} variant="orange">Nacharbeit</UiButton>
              </div>
            </>
          ) : (
            <UiButton disabled={pending || !canReopen} onClick={() => onReopen(task)} variant="blue">
              Review wieder öffnen
            </UiButton>
          )}
          {!canReview && !final ? <p className="text-xs leading-5 text-slate-500">Nur Review Owner, CEO oder Deputy können diese Review finalisieren.</p> : null}
          {final && !canReopen ? <p className="text-xs leading-5 text-slate-500">Nur Review Owner, CEO oder Deputy können diese Review wieder öffnen.</p> : null}
        </div>
      </div>
    </section>
  );
}

function ReviewTextBlock({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{value}</p>
    </div>
  );
}
