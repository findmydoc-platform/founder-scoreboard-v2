"use client";

import { AlertTriangle, Plus, X } from "lucide-react";
import { useState } from "react";
import type { TaskBlocker } from "@/lib/types";
import { UiBadge, UiButton, UiEmptyState, UiField, UiTextArea, UiTextInput } from "@/shared/atoms/ui-primitives";

type BlockerDraft = {
  reason: string;
  impact: string;
  needsHelpFrom: string;
};

type Props = {
  canReport?: boolean;
  blockers: TaskBlocker[];
  blockerDraft: BlockerDraft;
  pending: boolean;
  profileName: (profileId: string) => string;
  onBlockerDraftChange: (patch: Partial<BlockerDraft>) => void;
  onReportBlocker: (draft: BlockerDraft) => void;
};

export function TaskDetailPanelBlockerSection({
  canReport = true,
  blockers,
  blockerDraft,
  pending,
  profileName,
  onBlockerDraftChange,
  onReportBlocker,
}: Props) {
  const [formOpen, setFormOpen] = useState(false);
  const openBlockers = blockers.filter((blocker) => blocker.status === "open");

  return (
    <section className="border-b border-slate-100 py-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <AlertTriangle size={16} className="text-amber-600" aria-hidden="true" />
            Gemeldete Blocker
          </h3>
          <p className="mt-1 text-xs text-slate-500">Operative Hindernisse mit Auswirkung und benötigter Hilfe.</p>
        </div>
        <div className="flex items-center gap-2">
          <UiBadge tone={openBlockers.length ? "amber" : "white"}>{openBlockers.length} offen</UiBadge>
          {canReport && !formOpen ? (
            <UiButton size="lg" className="h-11" onClick={() => setFormOpen(true)} aria-expanded="false" aria-controls="task-blocker-form">
              <Plus size={15} aria-hidden="true" />
              Blocker melden
            </UiButton>
          ) : null}
        </div>
      </div>
      <div className="mt-3 grid gap-2">
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
        {!blockers.length ? <UiEmptyState tone="muted">Kein Blocker gemeldet.</UiEmptyState> : null}
      </div>
      {canReport && formOpen ? (
        <form
          id="task-blocker-form"
          className="mt-4 grid gap-3 rounded-lg border border-amber-200 bg-amber-50/50 p-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (blockerDraft.reason.trim().length < 5) return;
            onReportBlocker(blockerDraft);
            setFormOpen(false);
          }}
        >
          <UiField>
            Grund
            <UiTextArea
              value={blockerDraft.reason}
              onChange={(event) => onBlockerDraftChange({ reason: event.target.value })}
              className="min-h-20 w-full p-3 leading-6"
              placeholder="Was blockiert die Arbeit konkret?"
            />
          </UiField>
          <UiField>
            Auswirkung
            <UiTextInput
              value={blockerDraft.impact}
              onChange={(event) => onBlockerDraftChange({ impact: event.target.value })}
              className="h-11 px-3"
              placeholder="Auswirkung auf Sprint oder Review"
            />
          </UiField>
          <UiField>
            Benötigte Hilfe
            <UiTextInput
              value={blockerDraft.needsHelpFrom}
              onChange={(event) => onBlockerDraftChange({ needsHelpFrom: event.target.value })}
              className="h-11 px-3"
              placeholder="Wer oder was wird gebraucht?"
            />
          </UiField>
          <div className="flex flex-wrap justify-end gap-2">
            <UiButton type="button" size="lg" disabled={pending} onClick={() => setFormOpen(false)}>
              <X size={15} aria-hidden="true" />
              Abbrechen
            </UiButton>
            <UiButton type="submit" size="lg" disabled={pending || blockerDraft.reason.trim().length < 5} variant="amberPrimary">
              {pending ? "Meldet …" : "Blocker melden"}
            </UiButton>
          </div>
        </form>
      ) : null}
    </section>
  );
}
