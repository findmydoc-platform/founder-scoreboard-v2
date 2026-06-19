"use client";

import { taskOwnerLabel } from "@/lib/display";
import { normalizeStatus } from "@/lib/status";
import type { Task } from "@/lib/types";
import { UiEmptyState, UiPanel } from "@/shared/atoms/ui-primitives";

type Props = {
  subIssues: Task[];
};

export function TaskSubIssuesSection({ subIssues }: Props) {
  return (
    <UiPanel padding="lg">
      <h2 className="text-sm font-semibold text-slate-950">Sub-Issues</h2>
      <div className="mt-3 grid gap-2">
        {subIssues.map((item) => (
          <article key={item.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
            <div className="font-semibold text-slate-800">{item.title}</div>
            <div className="mt-1 text-xs text-slate-500">{normalizeStatus(item.status)} · {taskOwnerLabel(item)} · nicht score-relevant</div>
          </article>
        ))}
        {!subIssues.length && <UiEmptyState>Noch keine Sub-Issues.</UiEmptyState>}
      </div>
    </UiPanel>
  );
}
