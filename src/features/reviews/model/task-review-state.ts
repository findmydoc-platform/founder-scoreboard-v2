import type { ReviewDecision, Task, TaskReviewChecklist, TaskStatus } from "@/lib/types";

export const REVIEW_LOCKED_MESSAGE = "Dieses Issue ist während des aktiven Reviews geschützt. Schließe das Review ab oder ziehe es mit Begründung zurück.";
export const REVIEW_FINAL_LOCKED_MESSAGE = "Dieses Issue ist nach dem finalen Review geschützt. Öffne das Review erneut, bevor du den Inhalt änderst.";

export const reviewDecisionLabels: Record<ReviewDecision, string> = {
  accepted: "Akzeptiert",
  partial: "Kleine Nacharbeit",
  changes_requested: "Grundlegend überarbeiten",
};

export const reviewChecklistKeys: Array<keyof TaskReviewChecklist> = [
  "acceptanceCriteriaMet",
  "evidenceProvided",
  "communicationClear",
  "blockerHandled",
];

export function isTaskReviewActive(task: Pick<Task, "reviewStatus" | "scoreFinal">) {
  return isReviewStateActive(task.reviewStatus, task.scoreFinal);
}

export function isTaskReviewFinal(task: Pick<Task, "reviewStatus" | "scoreFinal">) {
  return isReviewStateFinal(task.reviewStatus, task.scoreFinal);
}

export function isTaskReviewLocked(task: Pick<Task, "reviewStatus" | "scoreFinal">) {
  return isReviewStateLocked(task.reviewStatus, task.scoreFinal);
}

export function reviewLockMessage(task: Pick<Task, "reviewStatus" | "scoreFinal">) {
  return task.scoreFinal ? REVIEW_FINAL_LOCKED_MESSAGE : REVIEW_LOCKED_MESSAGE;
}

export function isReviewStateActive(reviewStatus: string | null | undefined, scoreFinal: boolean | null | undefined) {
  return reviewStatus === "requested" && !scoreFinal;
}

export function isReviewStateFinal(reviewStatus: string | null | undefined, scoreFinal: boolean | null | undefined) {
  return Boolean(scoreFinal) && reviewStatus === "accepted";
}

export function isReviewStateLocked(reviewStatus: string | null | undefined, scoreFinal: boolean | null | undefined) {
  return isReviewStateActive(reviewStatus, scoreFinal) || isReviewStateFinal(reviewStatus, scoreFinal);
}

export function reviewStateLockMessage(reviewStatus: string | null | undefined, scoreFinal: boolean | null | undefined) {
  return isReviewStateFinal(reviewStatus, scoreFinal) ? REVIEW_FINAL_LOCKED_MESSAGE : REVIEW_LOCKED_MESSAGE;
}

export function reviewChecklistCheckedCount(checklist: TaskReviewChecklist) {
  return [
    checklist.acceptanceCriteriaMet ?? checklist.dodMet,
    checklist.evidenceProvided,
    checklist.communicationClear,
    checklist.blockerHandled,
  ].filter(Boolean).length;
}

export function reviewChecklistScore(checklist: TaskReviewChecklist) {
  return Math.round((reviewChecklistCheckedCount(checklist) / reviewChecklistKeys.length) * 10);
}

export function isReviewChecklistComplete(checklist: TaskReviewChecklist) {
  return Boolean(
    (checklist.acceptanceCriteriaMet ?? checklist.dodMet)
    && checklist.evidenceProvided
    && checklist.communicationClear
    && checklist.blockerHandled
  );
}

export function reviewDecisionTaskState(decision: ReviewDecision): {
  status: TaskStatus;
  scoreFinal: boolean;
} {
  if (decision === "accepted") return { status: "Erledigt", scoreFinal: true };
  return { status: "Nacharbeit", scoreFinal: false };
}

export function isReviewReworkDecision(decision: ReviewDecision) {
  return decision !== "accepted";
}

export function reviewDecisionConsequence(decision: ReviewDecision, points: number) {
  if (decision === "accepted") return "Status: Erledigt · Inhalt geschützt · Score: 10/10 final";
  if (decision === "partial") return `Status: Nacharbeit · kleine Korrekturen · weiterbearbeitbar · Score: ${points}/10 abgeleitet, offen`;
  return "Status: Nacharbeit · grundlegend überarbeiten · weiterbearbeitbar · Score: offen";
}

export function reviewDecisionValidation(
  decision: ReviewDecision | "",
  checklist: TaskReviewChecklist,
  comment: string,
): { ok: true } | { ok: false; message: string } {
  if (!decision) return { ok: false, message: "Wähle eine Review-Entscheidung." };
  if (decision === "accepted" && !isReviewChecklistComplete(checklist)) {
    return { ok: false, message: "Akzeptiert setzt vier erfüllte Prüfpunkte voraus." };
  }
  const checkedCount = reviewChecklistCheckedCount(checklist);
  if (decision === "partial" && (checkedCount < 1 || checkedCount > 3)) {
    return { ok: false, message: "Kleine Nacharbeit setzt ein bis drei erfüllte Prüfpunkte voraus." };
  }
  if ((decision === "partial" || decision === "changes_requested") && !comment.trim()) {
    return { ok: false, message: "Für diese Entscheidung ist ein Review-Kommentar erforderlich." };
  }
  return { ok: true };
}

export function hasReviewLockedTaskChanges(payload: unknown, options: { allowReviewOwnerChange?: boolean } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return true;
  const allowedKeys = new Set(["expectedUpdatedAt"]);
  if (options.allowReviewOwnerChange) allowedKeys.add("reviewOwnerProfileId");
  return Object.keys(payload).some((key) => !allowedKeys.has(key));
}
