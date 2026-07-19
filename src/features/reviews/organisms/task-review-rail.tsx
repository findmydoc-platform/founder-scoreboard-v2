"use client";

import { Check, RotateCcw } from "lucide-react";
import { useEffect, useState } from "react";
import { clearTaskReviewDraft, useTaskReviewDraft } from "@/features/reviews/hooks/use-task-review-draft";
import {
  reviewChecklistScore,
  reviewDecisionConsequence,
  reviewDecisionLabels,
  reviewDecisionValidation,
} from "@/features/reviews/model/task-review-state";
import type { Profile, ReviewDecision, Task, TaskReviewChecklist } from "@/lib/types";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { classNames, UiButton, UiNotice, UiTextArea } from "@/shared/atoms/ui-primitives";

const reviewChecks: Array<{
  key: keyof TaskReviewChecklist;
  label: string;
  targetId: string;
  targetLabel: string;
}> = [
  { key: "acceptanceCriteriaMet", label: "Abnahmekriterien erfüllt", targetId: "task-review-acceptance", targetLabel: "Abnahmekriterien" },
  { key: "evidenceProvided", label: "Nachweis vollständig", targetId: "task-review-evidence", targetLabel: "Nachweis" },
  { key: "communicationClear", label: "Ergebnis klar nachvollziehbar", targetId: "task-review-outcome", targetLabel: "Zielbild" },
  { key: "blockerHandled", label: "Abhängigkeiten geklärt", targetId: "task-review-dependencies", targetLabel: "Abhängigkeiten" },
];

const decisionStyles: Record<ReviewDecision, { idle: string; selected: string }> = {
  accepted: {
    idle: "border-emerald-300 bg-white text-emerald-700 hover:border-emerald-500 hover:bg-emerald-50",
    selected: "border-emerald-500 bg-emerald-50 text-emerald-800 ring-2 ring-emerald-100",
  },
  partial: {
    idle: "border-amber-300 bg-white text-amber-700 hover:border-amber-500 hover:bg-amber-50",
    selected: "border-amber-500 bg-amber-50 text-amber-800 ring-2 ring-amber-100",
  },
  changes_requested: {
    idle: "border-red-300 bg-white text-red-700 hover:border-red-500 hover:bg-red-50",
    selected: "border-red-500 bg-red-50 text-red-800 ring-2 ring-red-100",
  },
};

type Props = {
  task: Task;
  currentProfileId: string;
  profiles: Profile[];
  canReview: boolean;
  canWithdraw: boolean;
  canManageReviewOwner: boolean;
  pending: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onReview: (task: Task, decision: ReviewDecision, score: number, checklist: TaskReviewChecklist, comment: string) => Promise<boolean> | boolean | void;
  onWithdraw: (task: Task, reason: string) => Promise<boolean> | boolean | void;
  onReviewOwnerChange: (reviewOwnerProfileId: string) => void;
  onJumpToSection: (targetId: string) => void;
};

function reviewOwnerLabel(task: Task, profiles: Profile[]) {
  return profiles.find((profile) => profile.id === task.reviewOwnerProfileId)?.name || task.reviewOwnerProfileId || "Noch nicht zugewiesen";
}

function reviewRequestedLabel(value?: string) {
  if (!value) return "Zeitpunkt nicht verfügbar";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function TaskReviewRail({
  task,
  currentProfileId,
  profiles,
  canReview,
  canWithdraw,
  canManageReviewOwner,
  pending,
  onDirtyChange,
  onReview,
  onWithdraw,
  onReviewOwnerChange,
  onJumpToSection,
}: Props) {
  const { draft, dirty, setDraft } = useTaskReviewDraft(task.id, task.reviewRequestedAt || "", currentProfileId);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawReason, setWithdrawReason] = useState("");
  const score = reviewChecklistScore(draft.checklist);
  const checkedCount = reviewChecks.filter((item) => Boolean(draft.checklist[item.key])).length;
  const progress = Math.round((checkedCount / reviewChecks.length) * 100);
  const validation = reviewDecisionValidation(draft.decision, draft.checklist, draft.comment);
  const validationMessage = validationAttempted && !validation.ok ? validation.message : "";

  useEffect(() => {
    onDirtyChange?.(dirty || Boolean(withdrawReason.trim()));
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange, withdrawReason]);

  const submit = async () => {
    if (!draft.decision || !validation.ok) {
      setValidationAttempted(true);
      window.requestAnimationFrame(() => {
        const targetId = !draft.decision
          ? `review-decision-${task.id}`
          : draft.decision === "accepted" || draft.decision === "partial" && (checkedCount < 1 || checkedCount > 3)
            ? `review-checklist-${task.id}`
            : `review-comment-${task.id}`;
        document.getElementById(targetId)?.focus();
      });
      return;
    }
    const result = await onReview(task, draft.decision, score, draft.checklist, draft.comment.trim());
    if (result !== false) clearTaskReviewDraft(task.id, task.reviewRequestedAt || "", currentProfileId);
  };

  const submitWithdraw = async () => {
    if (!withdrawReason.trim()) return;
    const result = await onWithdraw(task, withdrawReason.trim());
    if (result !== false) {
      clearTaskReviewDraft(task.id, task.reviewRequestedAt || "", currentProfileId);
      setWithdrawReason("");
      setWithdrawOpen(false);
    }
  };

  return (
    <aside aria-labelledby="task-review-heading" className="mt-6 min-w-0 border-t border-slate-200 bg-white pt-6 xl:mt-0 xl:border-l xl:border-t-0 xl:pb-6 xl:pl-8 xl:pt-5">
      <div className="xl:sticky xl:top-5">
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-3">
          <h2 id="task-review-heading" className="pt-0.5 text-lg font-semibold tracking-tight text-slate-950">Review durchführen</h2>
          <dl className="grid shrink-0 gap-1.5 text-xs">
            <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 text-slate-700">
              <dt className="font-medium text-slate-500">Review Owner</dt>
              <dd className="min-w-0 font-medium">
                {canManageReviewOwner ? (
                  <CustomSelect
                    value={task.reviewOwnerProfileId || ""}
                    onChange={onReviewOwnerChange}
                    disabled={pending}
                    className="h-7 w-36 text-xs"
                    aria-label="Review Owner ändern"
                    options={profiles.filter((profile) => profile.platformRole !== "viewer").map((profile) => ({ value: profile.id, label: profile.name }))}
                  />
                ) : reviewOwnerLabel(task, profiles)}
              </dd>
            </div>
            <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 text-slate-500">
              <dt className="font-medium">Angefragt</dt>
              <dd>{reviewRequestedLabel(task.reviewRequestedAt)}</dd>
            </div>
          </dl>
        </div>

        {!canReview ? (
          <UiNotice tone="info" className="mt-4">
            Das Issue ist im Review und schreibgeschützt. Die Entscheidung liegt bei {reviewOwnerLabel(task, profiles)}.
          </UiNotice>
        ) : (
          <>
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-slate-950">Prüfkriterien</h3>
              <div className="mt-2 flex items-center justify-between gap-3 text-xs text-slate-500">
                <span>{checkedCount} von {reviewChecks.length} geprüft</span>
                <span className="tabular-nums">{progress}%</span>
              </div>
              <div
                className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200"
                role="progressbar"
                aria-label={`${checkedCount} von ${reviewChecks.length} Prüfkriterien erfüllt`}
                aria-valuemin={0}
                aria-valuemax={reviewChecks.length}
                aria-valuenow={checkedCount}
              >
                <div className="h-full rounded-full bg-blue-600 transition-[width]" style={{ width: `${progress}%` }} />
              </div>
            </div>

            <div id={`review-checklist-${task.id}`} tabIndex={-1} className="mt-3 grid gap-0.5 pb-3 outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
              {reviewChecks.map((item) => {
                const checked = Boolean(draft.checklist[item.key]);
                return (
                  <div key={item.key} className="flex min-h-9 items-center gap-2 rounded-md px-1 transition hover:bg-slate-50">
                    <label className="flex min-h-9 min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-sm font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={pending}
                        onChange={(event) => {
                          setDraft((current) => ({ ...current, checklist: { ...current.checklist, [item.key]: event.target.checked } }));
                        }}
                        className="sr-only"
                      />
                      <span className={classNames(
                        "grid h-5 w-5 shrink-0 place-items-center rounded border transition",
                        checked ? "border-blue-600 bg-blue-600 text-white" : "border-slate-300 bg-white",
                      )} aria-hidden="true">
                        {checked ? <Check size={13} /> : null}
                      </span>
                      <span>{item.label}</span>
                    </label>
                    <button
                      type="button"
                      aria-label={`${item.targetLabel} im Issue ansehen`}
                      onClick={() => onJumpToSection(item.targetId)}
                      className="inline-flex min-h-9 shrink-0 items-center px-1 text-xs font-medium text-slate-600 hover:text-blue-800 hover:underline"
                    >
                      Ansehen
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="border-t border-slate-200 pt-3">
              <div className="flex items-center justify-between gap-3 text-xs text-slate-500">
                <span className="font-semibold text-slate-600">Score</span>
                <span>abgeleitete Punkte</span>
              </div>
              <div className="mt-1 text-2xl font-semibold tabular-nums text-slate-950">{score}<span className="text-base text-slate-400">/10</span></div>
            </div>

            <label className="mt-3 block text-sm font-semibold text-slate-950" htmlFor={`review-comment-${task.id}`}>
              Review-Kommentar
            </label>
            <p className="mt-1 text-xs leading-5 text-slate-500">Bei kleiner oder grundlegender Nacharbeit verpflichtend.</p>
            <UiTextArea
              id={`review-comment-${task.id}`}
              value={draft.comment}
              disabled={pending}
              minHeight="md"
              inputPadding="md"
              leading="relaxed"
              className="mt-2 w-full bg-white"
              placeholder="Was kann bestehen bleiben, was muss geändert werden?"
              onChange={(event) => {
                setDraft((current) => ({ ...current, comment: event.target.value }));
              }}
            />

            <fieldset id={`review-decision-${task.id}`} tabIndex={-1} className="mt-3 outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
              <legend className="text-sm font-semibold text-slate-950">Entscheidung</legend>
              <div className="mt-2 grid grid-cols-1 gap-2 min-[420px]:grid-cols-3" aria-label="Review-Entscheidung">
                {(Object.keys(reviewDecisionLabels) as ReviewDecision[]).map((decision) => (
                  <button
                    key={decision}
                    type="button"
                    aria-label={reviewDecisionLabels[decision]}
                    aria-pressed={draft.decision === decision}
                    disabled={pending}
                    onClick={() => {
                      setDraft((current) => ({ ...current, decision }));
                    }}
                    className={classNames(
                      "flex min-h-12 items-center justify-center rounded-lg border px-2 py-2 text-center text-xs font-semibold leading-4 transition focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50",
                      draft.decision === decision ? decisionStyles[decision].selected : decisionStyles[decision].idle,
                    )}
                  >
                    <span>{reviewDecisionLabels[decision]}</span>
                  </button>
                ))}
              </div>
            </fieldset>

            {draft.decision ? (
              <p className="mt-3 text-xs font-medium leading-5 text-slate-600">
                {reviewDecisionConsequence(draft.decision, score)}
              </p>
            ) : null}

            {validationMessage ? (
              <p id={`review-validation-${task.id}`} role="alert" className="mt-3 text-xs font-semibold text-red-700">
                {validationMessage}
              </p>
            ) : null}
            <UiButton
              size="lg"
              variant="primary"
              disabled={pending}
              aria-describedby={validationMessage ? `review-validation-${task.id}` : undefined}
              onClick={submit}
              className="mt-3 w-full"
            >
              {pending ? "Wird abgeschlossen …" : "Review abschließen"}
            </UiButton>
          </>
        )}

        {canWithdraw ? (
          <div className="mt-3 border-t border-slate-200 pt-3">
            {!withdrawOpen ? (
              <button type="button" onClick={() => setWithdrawOpen(true)} className="inline-flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-950">
                <RotateCcw size={14} aria-hidden="true" />
                Review zurückziehen
              </button>
            ) : (
              <div className="grid gap-2 rounded-lg border border-slate-200 bg-white p-3">
                <label htmlFor={`review-withdraw-${task.id}`} className="text-xs font-semibold text-slate-800">Grund für das Zurückziehen</label>
                <UiTextArea
                  id={`review-withdraw-${task.id}`}
                  value={withdrawReason}
                  onChange={(event) => setWithdrawReason(event.target.value)}
                  disabled={pending}
                  minHeight="sm"
                  placeholder="Warum wird das Review beendet?"
                />
                <div className="flex justify-end gap-2">
                  <UiButton size="sm" onClick={() => { setWithdrawOpen(false); setWithdrawReason(""); }} disabled={pending}>Abbrechen</UiButton>
                  <UiButton size="sm" variant="red" onClick={submitWithdraw} disabled={pending || !withdrawReason.trim()}>Zurückziehen</UiButton>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
