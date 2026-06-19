"use client";

import type { TaskBlocker } from "@/lib/types";
import { UiBadge, UiButton, UiEmptyState, UiTextArea, UiTextInput } from "@/shared/atoms/ui-primitives";

type BlockerDraft = {
  reason: string;
  impact: string;
  needsHelpFrom: string;
};

type Props = {
  blockers: TaskBlocker[];
  blockerDraft: BlockerDraft;
  pending: boolean;
  profileName: (profileId: string) => string;
  onBlockerDraftChange: (patch: Partial<BlockerDraft>) => void;
  onReportBlocker: (draft: BlockerDraft) => void;
};

export function TaskDetailPanelBlockerSection({
  blockers,
  blockerDraft,
  pending,
  profileName,
  onBlockerDraftChange,
  onReportBlocker,
}: Props) {
  return (
    <section className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">Blocker</h3>
          <p className="mt-1 text-xs text-slate-500">Blocker früh melden, damit der Sprint planbar bleibt.</p>
        </div>
        <UiBadge tone="white">{blockers.filter((blocker) => blocker.status === "open").length} offen</UiBadge>
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
        {!blockers.length && <UiEmptyState>Noch kein Blocker gemeldet.</UiEmptyState>}
      </div>
      <div className="mt-3 grid gap-2">
        <UiTextArea
          value={blockerDraft.reason}
          onChange={(event) => onBlockerDraftChange({ reason: event.target.value })}
          className="min-h-20 w-full p-3 leading-6"
          placeholder="Was blockiert dich konkret?"
        />
        <UiTextInput
          value={blockerDraft.impact}
          onChange={(event) => onBlockerDraftChange({ impact: event.target.value })}
          className="px-3"
          placeholder="Auswirkung auf Sprint oder Review"
        />
        <UiTextInput
          value={blockerDraft.needsHelpFrom}
          onChange={(event) => onBlockerDraftChange({ needsHelpFrom: event.target.value })}
          className="px-3"
          placeholder="Braucht Hilfe von"
        />
        <div className="flex justify-end">
          <UiButton
            disabled={pending || blockerDraft.reason.trim().length < 5}
            onClick={() => onReportBlocker(blockerDraft)}
            variant="orange"
          >
            Blocker melden
          </UiButton>
        </div>
      </div>
    </section>
  );
}
