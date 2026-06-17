"use client";

import { useState } from "react";
import Link from "next/link";
import { dateRange } from "@/lib/display";
import { reviewLabel } from "@/lib/platform";
import { reviewChecklistItems, reviewChecklistScore } from "@/lib/sprint-score-view-model";
import type { Task } from "@/lib/types";

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
            <p className="mt-1 text-xs text-slate-600">
              {task.owner} · {task.priority} · {task.hours}h · {dateRange(task)} · {reviewLabel(task.reviewStatus)} · {reviewOwnerName}
            </p>
          </div>
          <Link href={`/tasks/${encodeURIComponent(task.id)}`} className="h-8 rounded-md border border-blue-200 bg-white px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-50">
            Aufgabe öffnen
          </Link>
        </div>
        <p className="mt-2 text-xs leading-5 text-blue-800">
          Review-Rohpunkte entstehen hier im Review-Blatt. Der Sprint-Gesamtscore bleibt im 20-Punkte-Modell von Sprint & Score.
        </p>
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
          {final ? (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm leading-6 text-emerald-800">
              Diese Review ist abgeschlossen: {task.scorePoints} Punkte · {reviewLabel(task.reviewStatus)}.
            </div>
          ) : (
            <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
              Review-Rohpunkte: vier Kriterien ergeben je 2,5 Punkte, gerundet auf 0 bis 10.
            </div>
          )}
          {reviewChecklistItems.map(([key, label, pointsLabel]) => (
            <label key={key} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2 text-sm text-slate-700">
              <span>
                <span className="block">{label}</span>
                <span className="text-xs text-slate-500">{pointsLabel}</span>
              </span>
              <input
                type="checkbox"
                checked={Boolean(checklist[key as keyof ReviewChecklist])}
                disabled={pending || final}
                onChange={(event) => setChecklist((current) => ({ ...current, [key]: event.target.checked }))}
              />
            </label>
          ))}
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Automatische Review-Rohpunkte
            <input
              type="number"
              min={0}
              max={10}
              value={final ? task.scorePoints : reviewScore}
              readOnly
              className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-800"
            />
          </label>
          {!final ? (
            <>
              <p className="text-[11px] leading-5 text-slate-500">Nacharbeit vergibt 0 finale Punkte und verschiebt die Aufgabe zurück in den Status Nacharbeit.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={pending || !canReview} onClick={() => onReview(task, "accepted", reviewScore, checklist, comment)} className="h-9 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">Akzeptieren</button>
                <button type="button" disabled={pending || !canReview} onClick={() => onReview(task, "partial", reviewScore, checklist, comment)} className="h-9 rounded-md border border-amber-200 bg-amber-50 px-3 text-sm font-semibold text-amber-700 disabled:cursor-not-allowed disabled:opacity-50">Teilweise</button>
                <button type="button" disabled={pending || !canReview} onClick={() => onReview(task, "changes_requested", 0, checklist, comment)} className="h-9 rounded-md border border-orange-200 bg-orange-50 px-3 text-sm font-semibold text-orange-700 disabled:cursor-not-allowed disabled:opacity-50">Nacharbeit</button>
              </div>
            </>
          ) : (
            <button type="button" disabled={pending || !canReopen} onClick={() => onReopen(task)} className="h-9 rounded-md border border-blue-200 bg-blue-50 px-3 text-sm font-semibold text-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
              Review wieder öffnen
            </button>
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
