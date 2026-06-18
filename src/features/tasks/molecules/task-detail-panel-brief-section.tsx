"use client";

import { TaskChecklist } from "@/features/tasks/molecules/task-checklist";
import type { Task } from "@/lib/types";

type Props = {
  task: Task;
  onUpdate: (patch: Partial<Task>) => void;
};

export function TaskDetailPanelBriefSection({ task, onUpdate }: Props) {
  return (
    <section className="rounded-lg border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-950">Aufgabenbrief</h3>
      <div className="mt-4 grid gap-4">
        <div>
          <h4 className="text-xs font-semibold text-slate-500">Problem Statement</h4>
          <p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">
            {task.problemStatement || task.description || "Kein Problem Statement hinterlegt."}
          </p>
        </div>
        <div>
          <h4 className="text-xs font-semibold text-slate-500">Intended Outcome</h4>
          <p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">
            {task.intendedOutcome || "Kein Intended Outcome hinterlegt."}
          </p>
        </div>
        <div>
          <h4 className="text-xs font-semibold text-slate-500">Scope & Constraints</h4>
          <p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">
            {task.scopeConstraints || "Kein Scope hinterlegt."}
          </p>
        </div>
        <div>
          <h4 className="text-xs font-semibold text-slate-500">Acceptance Criteria</h4>
          <div className="mt-2">
            <TaskChecklist value={task.acceptanceCriteria || ""} emptyText="Keine Acceptance Criteria hinterlegt." onChange={(nextValue) => onUpdate({ acceptanceCriteria: nextValue })} />
          </div>
        </div>
        <div>
          <h4 className="text-xs font-semibold text-slate-500">Evidence Required</h4>
          <p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">
            {task.evidenceRequired || "Kein erwarteter Nachweis hinterlegt."}
          </p>
        </div>
        <div>
          <h4 className="text-xs font-semibold text-slate-500">Definition of Done</h4>
          <div className="mt-2">
            <TaskChecklist value={task.definitionOfDone || ""} emptyText="Keine Definition of Done hinterlegt." onChange={(nextValue) => onUpdate({ definitionOfDone: nextValue })} />
          </div>
        </div>
      </div>
    </section>
  );
}
