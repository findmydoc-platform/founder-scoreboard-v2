"use client";

import { taskOwnerLabel } from "@/lib/display";
import { normalizeStatus } from "@/lib/status";
import type { Task } from "@/lib/types";

type Props = {
  subIssues: Task[];
};

export function TaskSubIssuesSection({ subIssues }: Props) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-950">Sub-Issues</h2>
      <div className="mt-3 grid gap-2">
        {subIssues.map((item) => (
          <article key={item.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
            <div className="font-semibold text-slate-800">{item.title}</div>
            <div className="mt-1 text-xs text-slate-500">{normalizeStatus(item.status)} · {taskOwnerLabel(item)} · nicht score-relevant</div>
          </article>
        ))}
        {!subIssues.length && <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">Noch keine Sub-Issues.</div>}
      </div>
    </section>
  );
}
