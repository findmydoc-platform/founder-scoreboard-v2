"use client";

import { ChevronDown, ListChecks, Plus } from "lucide-react";
import { TaskReferenceLink } from "@/features/tasks/atoms/task-reference-link";
import { TaskStatusBadge } from "@/features/tasks/atoms/task-status-control";
import { partitionSubIssues } from "@/features/tasks/model/task-detail-presentation";
import { taskAssigneeLabel } from "@/lib/display";
import type { Task } from "@/lib/types";
import { UiButton, UiEmptyState } from "@/shared/atoms/ui-primitives";

type Props = {
  canCreate?: boolean;
  subIssues: Task[];
  loading?: boolean;
  error?: string;
  onCreateSubIssue: () => void;
  onOpenTask: (taskId: string) => void;
};

function SubIssueRow({ item, onOpenTask }: { item: Task; onOpenTask: (taskId: string) => void }) {
  return (
    <article className="grid min-h-16 grid-cols-[auto_minmax(0,1fr)] items-start gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3 shadow-sm sm:grid-cols-[auto_minmax(0,1fr)_auto]">
      <TaskStatusBadge status={item.status} size="xs" />
      <div className="min-w-0">
        <TaskReferenceLink task={item} onOpenTask={onOpenTask} className="break-words text-left text-sm font-semibold leading-5 text-slate-900 hover:text-blue-700">
          {item.title}
        </TaskReferenceLink>
        <p className="mt-1 text-xs text-slate-500">{taskAssigneeLabel(item)}</p>
      </div>
      <span className="hidden self-center text-xs font-medium text-slate-400 sm:block">Öffnen</span>
    </article>
  );
}

export function TaskDetailPanelSubIssuesSection({
  canCreate = true,
  subIssues,
  loading = false,
  error = "",
  onCreateSubIssue,
  onOpenTask,
}: Props) {
  const { open, completed } = partitionSubIssues(subIssues);
  const percentage = subIssues.length ? Math.round((completed.length / subIssues.length) * 100) : 0;

  return (
    <section aria-labelledby="task-sub-issues-heading" aria-busy={loading} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 id="task-sub-issues-heading" className="flex items-center gap-2 text-base font-semibold text-slate-950">
            <ListChecks size={18} className="text-blue-600" aria-hidden="true" />
            Sub-Issues
          </h2>
          <p className="mt-1 text-sm text-slate-500">Direkte Arbeitsschritte unter diesem Item.</p>
        </div>
        {canCreate ? (
          <UiButton onClick={onCreateSubIssue} size="lg" className="h-11">
            <Plus size={15} aria-hidden="true" />
            Sub-Issue hinzufügen
          </UiButton>
        ) : null}
      </div>

      {error ? <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</div> : null}
      {loading ? (
        <div className="mt-5 grid gap-3" aria-label="Sub-Issues werden geladen">
          <div className="h-2 animate-pulse rounded-full bg-slate-100" />
          <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
          <div className="h-16 animate-pulse rounded-lg bg-slate-100" />
        </div>
      ) : (
        <>
          {subIssues.length ? (
            <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-semibold text-slate-800">{completed.length} von {subIssues.length} erledigt</span>
                <span className="text-xs font-semibold text-slate-500">{percentage}%</span>
              </div>
              <div role="progressbar" aria-label={`${completed.length} von ${subIssues.length} Sub-Issues erledigt`} aria-valuemin={0} aria-valuemax={subIssues.length} aria-valuenow={completed.length} className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-blue-600" style={{ width: `${percentage}%` }} />
              </div>
            </div>
          ) : null}

          {open.length ? (
            <section className="mt-5" aria-labelledby="task-sub-issues-open-heading">
              <h3 id="task-sub-issues-open-heading" className="text-sm font-semibold text-slate-800">Offen {open.length}</h3>
              <div className="mt-3 grid gap-2">{open.map((item) => <SubIssueRow key={item.id} item={item} onOpenTask={onOpenTask} />)}</div>
            </section>
          ) : null}

          {completed.length ? (
            <details className="group mt-5 rounded-lg border border-slate-200 bg-slate-50" open={!open.length}>
              <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-400">
                Erledigt {completed.length}
                <ChevronDown size={16} className="transition group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="grid gap-2 border-t border-slate-200 p-3">{completed.map((item) => <SubIssueRow key={item.id} item={item} onOpenTask={onOpenTask} />)}</div>
            </details>
          ) : null}

          {!subIssues.length ? <UiEmptyState tone="muted" className="mt-5">Keine Sub-Issues vorhanden.</UiEmptyState> : null}
        </>
      )}
    </section>
  );
}
