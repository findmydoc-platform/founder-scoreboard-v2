"use client";

import { taskAssigneeLabel } from "@/lib/display";
import { TaskReferenceLink } from "@/features/tasks/atoms/task-reference-link";
import { normalizeStatus } from "@/lib/status";
import type { Task } from "@/lib/types";
import { UiButton, UiEmptyState } from "@/shared/atoms/ui-primitives";

type Props = {
  canCreate?: boolean;
  subIssues: Task[];
  onCreateSubIssue: () => void;
  onOpenTask: (taskId: string) => void;
};

export function TaskDetailPanelSubIssuesSection({ canCreate = true, subIssues, onCreateSubIssue, onOpenTask }: Props) {
  return (
    <section className="rounded-lg border border-slate-200 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-950">Sub-Issues</h3>
          <p className="mt-1 text-xs text-slate-500">Persönliche Arbeitsstruktur, nicht score-relevant.</p>
        </div>
        {canCreate && (
          <UiButton onClick={onCreateSubIssue} size="xs">
            Sub-Issue
          </UiButton>
        )}
      </div>
      <div className="mt-3 grid gap-2">
        {subIssues.map((item) => (
          <div key={item.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
            <TaskReferenceLink task={item} onOpenTask={onOpenTask} className="font-semibold text-slate-800">
              {item.title}
            </TaskReferenceLink>
            <div className="mt-1 text-xs text-slate-500">{normalizeStatus(item.status)} · {taskAssigneeLabel(item)}</div>
          </div>
        ))}
        {!subIssues.length && <UiEmptyState>Noch keine Sub-Issues.</UiEmptyState>}
      </div>
    </section>
  );
}
