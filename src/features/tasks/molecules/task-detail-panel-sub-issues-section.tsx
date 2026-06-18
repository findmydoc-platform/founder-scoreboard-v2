"use client";

import { taskOwnerLabel } from "@/lib/display";
import { normalizeStatus } from "@/lib/status";
import type { Task } from "@/lib/types";

type Props = {
  subIssues: Task[];
  onCreateSubIssue: () => void;
};

export function TaskDetailPanelSubIssuesSection({ subIssues, onCreateSubIssue }: Props) {
  return (
    <section className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">Sub-Issues</h3>
          <p className="mt-1 text-xs text-slate-500">Persönliche Arbeitsstruktur, nicht score-relevant.</p>
        </div>
        <button type="button" onClick={onCreateSubIssue} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          Sub-Issue
        </button>
      </div>
      <div className="mt-3 grid gap-2">
        {subIssues.map((item) => (
          <div key={item.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
            <div className="font-semibold text-slate-800">{item.title}</div>
            <div className="mt-1 text-xs text-slate-500">{normalizeStatus(item.status)} · {taskOwnerLabel(item)}</div>
          </div>
        ))}
        {!subIssues.length && <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">Noch keine Sub-Issues.</div>}
      </div>
    </section>
  );
}
