import { X } from "lucide-react";
import type { DecisionLinkedTask } from "@/features/decisions/model/decision-log-view-model";
import { taskOwnerLabel } from "@/lib/display";
import { normalizeStatus } from "@/lib/status";
import type { DecisionTaskLink } from "@/lib/types";

type DecisionFollowUpListProps = {
  linkedTasks: DecisionLinkedTask[];
  pending: boolean;
  onRemoveDecisionTaskLink: (link: DecisionTaskLink) => void;
};

export function DecisionFollowUpList({ linkedTasks, pending, onRemoveDecisionTaskLink }: DecisionFollowUpListProps) {
  return (
    <div className="mt-4 rounded-md border border-slate-100 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-xs font-semibold text-slate-500">Folgeaufgaben</h3>
        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500">{linkedTasks.length}</span>
      </div>
      <div className="mt-2 grid gap-1.5">
        {linkedTasks.length ? linkedTasks.map(({ link, task }) => (
          <div key={link.id} className="flex items-start gap-2 rounded-md bg-white px-2 py-1.5 text-xs">
            <div className="min-w-0 flex-1">
              <div className="font-semibold text-slate-800">{task.title}</div>
              <div className="mt-0.5 text-slate-500">{normalizeStatus(task.status)} · {taskOwnerLabel(task)} · {link.note || "Keine Notiz"}</div>
            </div>
            <button type="button" disabled={pending} onClick={() => onRemoveDecisionTaskLink(link)} className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50" aria-label="Decision-Link entfernen">
              <X size={12} />
            </button>
          </div>
        )) : (
          <div className="text-xs text-slate-500">Noch keine Folgeaufgabe verknüpft.</div>
        )}
      </div>
    </div>
  );
}
