"use client";

import type { TaskBlocker } from "@/lib/types";

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
        <span className="rounded-full border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600">{blockers.filter((blocker) => blocker.status === "open").length} offen</span>
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
        {!blockers.length && <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">Noch kein Blocker gemeldet.</div>}
      </div>
      <div className="mt-3 grid gap-2">
        <textarea
          value={blockerDraft.reason}
          onChange={(event) => onBlockerDraftChange({ reason: event.target.value })}
          className="min-h-20 w-full resize-y rounded-md border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-blue-400"
          placeholder="Was blockiert dich konkret?"
        />
        <input
          value={blockerDraft.impact}
          onChange={(event) => onBlockerDraftChange({ impact: event.target.value })}
          className="h-9 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"
          placeholder="Auswirkung auf Sprint oder Review"
        />
        <input
          value={blockerDraft.needsHelpFrom}
          onChange={(event) => onBlockerDraftChange({ needsHelpFrom: event.target.value })}
          className="h-9 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"
          placeholder="Braucht Hilfe von"
        />
        <div className="flex justify-end">
          <button
            type="button"
            disabled={pending || blockerDraft.reason.trim().length < 5}
            onClick={() => onReportBlocker(blockerDraft)}
            className="h-9 rounded-md border border-orange-200 bg-orange-50 px-3 text-sm font-semibold text-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Blocker melden
          </button>
        </div>
      </div>
    </section>
  );
}
