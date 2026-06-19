import { AlertTriangle } from "lucide-react";
import type { Task, TaskStatus } from "@/lib/types";
import { UiButton } from "@/shared/atoms/ui-primitives";

type StatusGuardDialogProps = {
  task: Task;
  notice: string;
  onUpdate: (task: Task, patch: Partial<Task>) => void;
  onClose: () => void;
};

export function StatusGuardDialog({ task, notice, onUpdate, onClose }: StatusGuardDialogProps) {
  return (
    <div className="fixed inset-x-4 top-24 z-50 mx-auto max-w-md rounded-lg border border-amber-200 bg-white p-4 text-sm shadow-xl">
      <div className="flex items-start gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-amber-50 text-amber-600">
          <AlertTriangle size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold text-slate-950">Status geschützt</h2>
          <p className="mt-1 leading-5 text-slate-600">{notice}</p>
          <p className="mt-2 truncate text-xs font-semibold text-slate-500">{task.title}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <UiButton type="button" onClick={() => onUpdate(task, { status: "Review" as TaskStatus })} variant="primary">
              In Review verschieben
            </UiButton>
            <UiButton type="button" onClick={() => onUpdate(task, { status: "Blockiert" as TaskStatus })}>
              Als blockiert markieren
            </UiButton>
            <UiButton type="button" onClick={onClose} variant="ghost">
              Abbrechen
            </UiButton>
          </div>
        </div>
      </div>
    </div>
  );
}
