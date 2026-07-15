"use client";

import { AlertTriangle, Plus, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { TaskActionResult } from "@/features/tasks/hooks/task-mutation-command-types";
import type { TaskBlocker } from "@/lib/types";
import { UiBadge, UiButton, UiField, UiTextArea, UiTextInput } from "@/shared/atoms/ui-primitives";

type BlockerDraft = {
  reason: string;
  impact: string;
  needsHelpFrom: string;
};

type Props = {
  canReport?: boolean;
  blockers: TaskBlocker[];
  blockerDraft: BlockerDraft;
  error?: string;
  loading?: boolean;
  unavailable?: boolean;
  pending: boolean;
  profileName: (profileId: string) => string;
  onBlockerDraftChange: (patch: Partial<BlockerDraft>) => void;
  onReportBlocker: (draft: BlockerDraft) => Promise<TaskActionResult>;
};

export function TaskDetailPanelBlockerSection({
  canReport = true,
  blockers,
  blockerDraft,
  error = "",
  loading = false,
  unavailable = false,
  pending,
  profileName,
  onBlockerDraftChange,
  onReportBlocker,
}: Props) {
  const generatedId = useId().replaceAll(":", "");
  const formId = `task-blocker-form-${generatedId}`;
  const reasonId = `task-blocker-reason-${generatedId}`;
  const reportErrorId = `task-blocker-report-error-${generatedId}`;
  const triggerId = `task-blocker-trigger-${generatedId}`;
  const [formOpen, setFormOpen] = useState(false);
  const [reportError, setReportError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const openBlockers = blockers.filter((blocker) => blocker.status === "open");
  const busy = pending || submitting;
  const compactEmpty = !loading && !error && !unavailable && blockers.length === 0 && !formOpen;

  useEffect(() => {
    if (!formOpen) return;
    const frame = window.requestAnimationFrame(() => document.getElementById(reasonId)?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [formOpen, reasonId]);

  const openForm = () => {
    setReportError("");
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setReportError("");
    window.requestAnimationFrame(() => document.getElementById(triggerId)?.focus());
  };

  const reportBlocker = async () => {
    if (blockerDraft.reason.trim().length < 5 || submitting) return;
    setSubmitting(true);
    setReportError("");
    try {
      const result = await onReportBlocker(blockerDraft);
      if (!result.ok) {
        setReportError(result.error);
        window.requestAnimationFrame(() => document.getElementById(reportErrorId)?.focus());
        return;
      }
      onBlockerDraftChange({ reason: "", impact: "", needsHelpFrom: "" });
      setFormOpen(false);
      window.requestAnimationFrame(() => document.getElementById(triggerId)?.focus());
    } catch (caught) {
      setReportError(caught instanceof Error ? caught.message : "Blocker konnte nicht gespeichert werden.");
      window.requestAnimationFrame(() => document.getElementById(reportErrorId)?.focus());
    } finally {
      setSubmitting(false);
    }
  };

  if (unavailable && blockers.length === 0 && !formOpen) return null;

  if (compactEmpty) {
    return canReport ? (
      <div className="flex justify-end border-b border-slate-100 py-5">
        <UiButton id={triggerId} size="lg" className="h-11" onClick={openForm} aria-expanded="false" aria-controls={formId}>
          <Plus size={15} aria-hidden="true" />
          Blocker melden
        </UiButton>
      </div>
    ) : null;
  }

  return (
    <section className="border-b border-slate-100 py-5" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <AlertTriangle size={16} className="text-amber-600" aria-hidden="true" />
            {blockers.length ? "Gemeldete Blocker" : formOpen ? "Blocker melden" : "Blocker"}
          </h3>
          {blockers.length || formOpen ? <p className="mt-1 text-xs text-slate-500">Operative Hindernisse mit Auswirkung und benötigter Hilfe.</p> : null}
        </div>
        <div className="flex items-center gap-2">
          {blockers.length ? <UiBadge tone={openBlockers.length ? "amber" : "white"}>{openBlockers.length} offen</UiBadge> : null}
          {canReport && !formOpen && !loading ? (
            <UiButton id={triggerId} size="lg" className="h-11" onClick={openForm} aria-expanded="false" aria-controls={formId}>
              <Plus size={15} aria-hidden="true" />
              Blocker melden
            </UiButton>
          ) : null}
        </div>
      </div>
      {error ? <div role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div> : null}
      {loading ? (
        <div className="mt-3 grid gap-2" aria-label="Blocker werden geladen">
          <div className="h-14 animate-pulse rounded-lg bg-slate-100" />
          <div className="h-14 animate-pulse rounded-lg bg-slate-100" />
        </div>
      ) : null}
      {blockers.length ? <div className="mt-3 grid gap-2">
        {blockers.map((blocker) => (
          <article key={blocker.id} className="rounded-md border border-orange-100 bg-orange-50 px-3 py-2 text-sm text-orange-950">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">{profileName(blocker.profileId)}</span>
              <span className="text-xs">{blocker.status}</span>
            </div>
            <p className="mt-1 leading-6">{blocker.reason}</p>
            {blocker.impact && <p className="mt-1 text-xs text-orange-800">Impact: {blocker.impact}</p>}
            {blocker.needsHelpFrom && <p className="mt-1 text-xs text-orange-800">Braucht Hilfe von: {blocker.needsHelpFrom}</p>}
          </article>
        ))}
      </div> : null}
      {canReport && formOpen ? (
        <form
          id={formId}
          className="mt-4 grid gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-4"
          aria-busy={submitting}
          onSubmit={async (event) => {
            event.preventDefault();
            await reportBlocker();
          }}
        >
          <UiField>
            Grund
            <UiTextArea
              id={reasonId}
              value={blockerDraft.reason}
              disabled={busy}
              aria-describedby={reportError ? reportErrorId : undefined}
              onChange={(event) => {
                setReportError("");
                onBlockerDraftChange({ reason: event.target.value });
              }}
              className="min-h-20 w-full p-3 leading-6"
              placeholder="Was blockiert die Arbeit konkret?"
            />
          </UiField>
          <UiField>
            Auswirkung
            <UiTextInput
              value={blockerDraft.impact}
              disabled={busy}
              onChange={(event) => {
                setReportError("");
                onBlockerDraftChange({ impact: event.target.value });
              }}
              className="h-11 px-3"
              placeholder="Auswirkung auf Sprint oder Review"
            />
          </UiField>
          <UiField>
            Benötigte Hilfe
            <UiTextInput
              value={blockerDraft.needsHelpFrom}
              disabled={busy}
              onChange={(event) => {
                setReportError("");
                onBlockerDraftChange({ needsHelpFrom: event.target.value });
              }}
              className="h-11 px-3"
              placeholder="Wer oder was wird gebraucht?"
            />
          </UiField>
          {reportError ? (
            <div id={reportErrorId} tabIndex={-1} role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 outline-none focus:ring-2 focus:ring-red-400">
              {reportError}
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <UiButton type="button" size="lg" disabled={busy} onClick={closeForm}>
              <X size={15} aria-hidden="true" />
              Abbrechen
            </UiButton>
            <UiButton type="submit" size="lg" disabled={busy || blockerDraft.reason.trim().length < 5} variant="amberPrimary">
              {submitting ? "Meldet …" : "Blocker melden"}
            </UiButton>
          </div>
        </form>
      ) : null}
    </section>
  );
}
