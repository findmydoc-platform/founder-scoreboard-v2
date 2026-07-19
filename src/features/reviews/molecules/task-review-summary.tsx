"use client";

import { CheckCircle2, ChevronDown, MessageSquareText, RotateCcw } from "lucide-react";
import { reviewDecisionLabels } from "@/features/reviews/model/task-review-state";
import { reviewLabel } from "@/lib/platform";
import type { Profile, ReviewDecision, Task, TaskReview } from "@/lib/types";
import { UiBadge, UiButton } from "@/shared/atoms/ui-primitives";

type Props = {
  task: Task;
  reviews: TaskReview[];
  profiles: Profile[];
  canReopen: boolean;
  pending: boolean;
  onReopen: (task: Task) => void;
};

function reviewDate(value: string) {
  if (!value) return "Datum nicht verfügbar";
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

export function TaskReviewSummary({ task, reviews, profiles, canReopen, pending, onReopen }: Props) {
  const sortedReviews = [...reviews].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const currentDecision: ReviewDecision | null = task.reviewStatus === "accepted" || task.reviewStatus === "partial" || task.reviewStatus === "changes_requested"
    ? task.reviewStatus
    : null;
  const displayedReviews: TaskReview[] = sortedReviews.length ? sortedReviews : (
    currentDecision
      ? [{
        id: -1,
        taskId: task.id,
        sprintId: task.sprintId,
        reviewerProfileId: task.reviewOwnerProfileId || "",
        decision: currentDecision,
        points: task.scorePoints,
        comment: "",
        checklist: {},
        createdAt: task.updatedAt || "",
      }]
      : []
  );
  if (!displayedReviews.length) return null;
  const latestReview = displayedReviews[0];
  const summaryLabel = currentDecision ? reviewLabel(currentDecision) : `Letztes Review: ${reviewDecisionLabels[latestReview.decision]}`;
  const summaryPoints = currentDecision ? task.scorePoints : latestReview.points;
  const summaryDecision = currentDecision || latestReview.decision;
  const summaryScoreLabel = summaryDecision === "accepted" && (!currentDecision || task.scoreFinal)
    ? `${summaryPoints}/10 · Score final`
    : summaryDecision === "partial"
      ? `${summaryPoints}/10 · abgeleitet · Score offen`
      : "Score offen";
  const summaryIconClass = summaryDecision === "accepted"
    ? "text-emerald-600"
    : summaryDecision === "partial"
      ? "text-amber-600"
      : "text-red-600";

  return (
    <details className="mt-4 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden hover:bg-slate-50">
        <div className="flex min-w-0 items-center gap-3">
          {summaryDecision === "accepted" ? (
            <CheckCircle2 size={18} className={`shrink-0 ${summaryIconClass}`} aria-hidden="true" />
          ) : (
            <RotateCcw size={18} className={`shrink-0 ${summaryIconClass}`} aria-hidden="true" />
          )}
          <div className="min-w-0">
            <div className="text-sm font-semibold text-slate-950">Review-Zusammenfassung</div>
            <div className="mt-0.5 text-xs text-slate-500">{summaryLabel} · {summaryScoreLabel}{displayedReviews.length > 1 ? ` · ${displayedReviews.length} Reviews` : ""}</div>
          </div>
        </div>
        <ChevronDown size={17} className="shrink-0 text-slate-400" aria-hidden="true" />
      </summary>
      <div className="border-t border-slate-200 px-4 py-4">
        <div className="grid gap-3">
          {displayedReviews.map((review, index) => {
            const reviewer = profiles.find((profile) => profile.id === review.reviewerProfileId)?.name || review.reviewerProfileId || "Unbekannt";
            return (
              <article key={review.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <UiBadge tone={review.decision === "accepted" ? "emerald" : review.decision === "partial" ? "amber" : "red"} size="xs">
                      {reviewDecisionLabels[review.decision]}
                    </UiBadge>
                    <span className="text-sm font-semibold text-slate-900">
                      {review.decision === "accepted"
                        ? `${review.points}/10 · Score final`
                        : review.decision === "partial"
                          ? `${review.points}/10 · abgeleitet · Score offen`
                          : "Score offen"}
                    </span>
                  </div>
                  {index === 0 ? <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{currentDecision ? "Aktuell" : "Zuletzt"}</span> : null}
                </div>
                <p className="mt-2 text-xs text-slate-500">{reviewer} · {reviewDate(review.createdAt)}</p>
                {review.comment ? (
                  <p className="mt-3 flex items-start gap-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">
                    <MessageSquareText size={15} className="mt-1 shrink-0 text-slate-400" aria-hidden="true" />
                    <span>{review.comment}</span>
                  </p>
                ) : null}
              </article>
            );
          })}
        </div>
        {canReopen && task.reviewStatus === "accepted" ? (
          <div className="mt-4 flex justify-end">
            <UiButton variant="blue" size="sm" disabled={pending} onClick={() => onReopen(task)}>
              <RotateCcw size={14} aria-hidden="true" />
              Review wieder öffnen
            </UiButton>
          </div>
        ) : null}
      </div>
    </details>
  );
}
