import { X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { CustomSelect } from "@/shared/atoms/custom-select";
import type { NewTaskDraft } from "@/features/tasks/organisms/new-task-dialog";
import { decisionStatusLabel } from "@/features/execution/model/execution-layer-view-model";
import { hasOpenWaitingRelation } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import type { DecisionTaskLink, PlanningData, Task, TaskRelation } from "@/lib/types";

type DraftSetter<T> = Dispatch<SetStateAction<Record<number, T>>>;

type ExecutionMetrics = {
  decisionsWithoutTasks: number;
};

export function ExecutionDecisionFollowups({
  data,
  taskById,
  openTasks,
  executionMetrics,
  decisionTaskDrafts,
  decisionNoteDrafts,
  pending,
  onDecisionTaskDraftsChange,
  onDecisionNoteDraftsChange,
  onOpenTask,
  onCreateTask,
  onLinkDecisionTask,
  onRemoveDecisionTaskLink,
}: {
  data: Pick<PlanningData, "decisions" | "decisionTaskLinks" | "tasks" | "taskRelations">;
  taskById: Map<string, Task>;
  openTasks: Task[];
  executionMetrics: ExecutionMetrics;
  decisionTaskDrafts: Record<number, string>;
  decisionNoteDrafts: Record<number, string>;
  pending: boolean;
  onDecisionTaskDraftsChange: DraftSetter<string>;
  onDecisionNoteDraftsChange: DraftSetter<string>;
  onOpenTask: (task: Task) => void;
  onCreateTask: (draft: Partial<NewTaskDraft>) => void;
  onLinkDecisionTask: (decisionId: number, taskId: string, note: string) => void;
  onRemoveDecisionTaskLink: (link: DecisionTaskLink) => void;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-slate-950">Decision-Folgearbeit</h2>
        <span className="text-xs font-semibold text-slate-500">{data.decisionTaskLinks.length} Links · {executionMetrics.decisionsWithoutTasks} offen</span>
      </div>
      <div className="mt-4 grid gap-3">
        {data.decisions.slice(0, 5).map((decision) => {
          const links = data.decisionTaskLinks.filter((link) => link.decisionId === decision.id);
          const linkedTasks = links.map((link) => ({ link, task: taskById.get(link.taskId) })).filter((item): item is { link: DecisionTaskLink; task: Task } => Boolean(item.task));
          const followUpCounts = {
            open: linkedTasks.filter(({ task }) => !["Erledigt", "Blockiert"].includes(normalizeStatus(task.status))).length,
            done: linkedTasks.filter(({ task }) => normalizeStatus(task.status) === "Erledigt").length,
            blocked: linkedTasks.filter(({ task }) => normalizeStatus(task.status) === "Blockiert" || hasOpenWaitingRelation(task.id, data.tasks, data.taskRelations as TaskRelation[])).length,
          };
          const selectedTaskId = decisionTaskDrafts[decision.id] || "";
          return (
            <article key={decision.id} className="rounded-md border border-slate-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-950">{decision.title}</h3>
                  <p className="mt-1 text-xs text-slate-500">{links.length} verknüpfte Aufgaben · {decisionStatusLabel(decision.status)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onCreateTask({
                    taskType: "deliverable",
                    title: `${decision.title} umsetzen`,
                    description: decision.context,
                    problemStatement: decision.context,
                    intendedOutcome: decision.decision,
                    acceptanceCriteria: decision.decision,
                    definitionOfDone: decision.decision,
                    decisionId: decision.id,
                    decisionLinkNote: "Folgeaufgabe aus Decision",
                  })}
                  className="h-8 shrink-0 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Folgeaufgabe
                </button>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] font-semibold">
                <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">{followUpCounts.open} Folgearbeit offen</span>
                <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">{followUpCounts.done} erledigt</span>
                <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">{followUpCounts.blocked} blockiert</span>
              </div>
              {links.length > 0 && (
                <div className="mt-3 grid gap-1">
                  {linkedTasks.map(({ link, task }) => {
                    const status = normalizeStatus(task.status);
                    const isBlocked = status === "Blockiert" || hasOpenWaitingRelation(task.id, data.tasks, data.taskRelations as TaskRelation[]);
                    return (
                      <div key={link.id} className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1">
                        <button type="button" onClick={() => onOpenTask(task)} className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-slate-700 hover:text-blue-700">{task.title}</button>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${status === "Erledigt" ? "bg-emerald-50 text-emerald-700" : isBlocked ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"}`}>
                          {status === "Erledigt" ? "erledigt" : isBlocked ? "blockiert" : "offen"}
                        </span>
                        <button type="button" disabled={pending} onClick={() => onRemoveDecisionTaskLink(link)} className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600" aria-label="Decision-Link entfernen">
                          <X size={12} />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="mt-3 grid gap-2">
                <CustomSelect
                  value={selectedTaskId}
                  onChange={(value) => onDecisionTaskDraftsChange((current) => ({ ...current, [decision.id]: value }))}
                  options={[{ value: "", label: "Aufgabe auswählen" }, ...openTasks.map((task) => ({ value: task.id, label: task.title }))]}
                  className="h-9 text-sm"
                />
                <input
                  value={decisionNoteDrafts[decision.id] || ""}
                  onChange={(event) => onDecisionNoteDraftsChange((current) => ({ ...current, [decision.id]: event.target.value }))}
                  className="h-9 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"
                  placeholder="Warum folgt diese Aufgabe aus der Decision?"
                />
                <button
                  type="button"
                  disabled={pending || !selectedTaskId}
                  onClick={() => onLinkDecisionTask(decision.id, selectedTaskId, decisionNoteDrafts[decision.id] || "")}
                  className="h-9 rounded-md bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                >
                  Verknüpfen
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
