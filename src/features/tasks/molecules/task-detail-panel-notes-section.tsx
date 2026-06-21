"use client";

import type { Task } from "@/lib/types";

type Props = {
  task: Task;
  pending: boolean;
  onUpdate: (patch: Partial<Task>) => void;
};

export function TaskDetailPanelNotesSection({ task, pending, onUpdate }: Props) {
  return (
    <section className="rounded-lg border border-slate-200 p-4">
      <h3 className="text-sm font-semibold text-slate-950">Notizen</h3>
      <textarea
        value={task.note}
        onChange={(event) => onUpdate({ note: event.target.value })}
        className="mt-2 min-h-28 w-full resize-y rounded-md border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-blue-400"
        placeholder="Interne Notiz, Entscheidung oder nächster Schritt"
      />
      <div className="mt-2 text-xs text-slate-500">{pending ? "Speichert..." : "Änderungen werden gespeichert."}</div>
    </section>
  );
}
