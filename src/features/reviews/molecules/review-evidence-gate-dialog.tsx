"use client";

import { FileText, Link2, X } from "lucide-react";
import { useId, useState } from "react";
import {
  validReviewEvidenceUrl,
  type ReviewEvidenceSubmission,
} from "@/features/reviews/model/review-evidence";
import { classNames, UiButton, UiTextArea, UiTextInput } from "@/shared/atoms/ui-primitives";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";

type EvidenceMode = "link" | "exception";

export function ReviewEvidenceGateDialog({
  pending,
  onClose,
  onConfirm,
}: {
  pending: boolean;
  onClose: () => void;
  onConfirm: (submission: ReviewEvidenceSubmission) => Promise<boolean> | boolean | void;
}) {
  const [mode, setMode] = useState<EvidenceMode>("exception");
  const [evidenceLink, setEvidenceLink] = useState("");
  const [exceptionNote, setExceptionNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const descriptionId = useId();
  const dialogRef = useModalDialog<HTMLDivElement>({
    open: true,
    onClose,
    closeDisabled: pending || submitting,
  });
  const trimmedLink = evidenceLink.trim();
  const trimmedNote = exceptionNote.trim();
  const valid = mode === "link" ? validReviewEvidenceUrl(trimmedLink) : Boolean(trimmedNote);

  const submit = async () => {
    if (!valid || pending || submitting) return;
    setSubmitting(true);
    const result = await onConfirm(mode === "link"
      ? { evidenceLink: trimmedLink }
      : { evidenceExceptionNote: trimmedNote });
    setSubmitting(false);
    if (result !== false) onClose();
  };

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-labelledby="review-evidence-gate-title"
      aria-describedby={descriptionId}
      className="fixed inset-0 z-[80] grid items-start justify-items-center overflow-y-auto bg-slate-950/40 p-2 sm:place-items-center sm:p-4"
    >
      <form
        className="my-2 w-full max-w-xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl sm:my-0"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div className="flex items-start justify-between gap-4 px-6 pb-3 pt-5">
          <div>
            <h2 id="review-evidence-gate-title" className="text-lg font-semibold tracking-tight text-slate-950">Nachweis vor Review</h2>
            <p id={descriptionId} className="mt-1.5 text-sm leading-6 text-slate-600">
              Für die Review-Anfrage braucht dieses Deliverable einen Nachweis.
            </p>
          </div>
          <button
            type="button"
            aria-label="Dialog schließen"
            disabled={pending || submitting}
            onClick={onClose}
            className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="grid gap-3 px-6 pb-5">
          <div className={classNames(
            "rounded-lg border p-4 transition",
            mode === "link" ? "border-blue-500 bg-blue-50/60 ring-2 ring-blue-100" : "border-slate-200 bg-white hover:border-slate-300",
          )}>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="review-evidence-mode"
                value="link"
                checked={mode === "link"}
                onChange={() => setMode("link")}
                className="mt-1 h-4 w-4 accent-blue-600"
              />
              <Link2 size={18} className="mt-0.5 shrink-0 text-slate-600" aria-hidden="true" />
              <span>
                <span className="block text-sm font-semibold text-slate-950">Evidence-Link hinzufügen</span>
                <span className="mt-0.5 block text-xs leading-5 text-slate-500">Link zu Dokumentation, Pull Request, Release oder Ergebnis.</span>
              </span>
            </label>
            <UiTextInput
              type="url"
              value={evidenceLink}
              onFocus={() => setMode("link")}
              onChange={(event) => {
                setMode("link");
                setEvidenceLink(event.target.value);
              }}
              placeholder="https://…"
              aria-label="Evidence-Link"
              className="mt-3 w-full bg-white"
            />
          </div>

          <div className={classNames(
            "rounded-lg border p-4 transition",
            mode === "exception" ? "border-blue-500 bg-blue-50/60 ring-2 ring-blue-100" : "border-slate-200 bg-white hover:border-slate-300",
          )}>
            <label className="flex cursor-pointer items-start gap-3">
              <input
                type="radio"
                name="review-evidence-mode"
                value="exception"
                checked={mode === "exception"}
                onChange={() => setMode("exception")}
                className="mt-1 h-4 w-4 accent-blue-600"
              />
              <FileText size={18} className="mt-0.5 shrink-0 text-slate-600" aria-hidden="true" />
              <span>
                <span className="block text-sm font-semibold text-slate-950">Ergebnis ohne Link dokumentieren</span>
                <span className="mt-0.5 block text-xs leading-5 text-slate-500">Kurze Begründung, warum kein Link vorliegt.</span>
              </span>
            </label>
            <div className="mt-3">
              <label htmlFor="review-evidence-exception-note" className="text-sm font-semibold text-slate-800">
                Begründung <span className="text-red-600" aria-hidden="true">*</span>
              </label>
              <UiTextArea
                id="review-evidence-exception-note"
                required={mode === "exception"}
                maxLength={2_000}
                value={exceptionNote}
                onFocus={() => setMode("exception")}
                onChange={(event) => {
                  setMode("exception");
                  setExceptionNote(event.target.value);
                }}
                placeholder="Wo und wie wurde das Ergebnis nachvollziehbar abgenommen?"
                className="mt-2 w-full bg-white"
                rows={4}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <UiButton disabled={pending || submitting} onClick={onClose}>Abbrechen</UiButton>
          <UiButton type="submit" variant="primary" disabled={pending || submitting || !valid}>
            In Review verschieben
          </UiButton>
        </div>
      </form>
    </div>
  );
}
