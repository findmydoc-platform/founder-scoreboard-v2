import { X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { CustomSelect } from "@/shared/atoms/custom-select";
import type { NewTaskDraft } from "@/features/tasks/organisms/new-task-dialog";
import { decisionStatusLabel } from "@/features/execution/model/execution-layer-view-model";
import { hasOpenWaitingRelation } from "@/lib/platform";
import { normalizeStatus } from "@/lib/status";
import type { DecisionTaskLink, PlanningData, Task, TaskRelation } from "@/lib/types";
import { UiBadge, UiButton, UiPanel, UiTextInput } from "@/shared/atoms/ui-primitives";

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
    <UiPanel className="min-w-0">
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
                <UiButton
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
                  size="sm"
                  className="shrink-0 text-slate-600"
                >
                  Folgeaufgabe
                </UiButton>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] font-semibold">
                <UiBadge tone="blue">{followUpCounts.open} Folgearbeit offen</UiBadge>
                <UiBadge tone="emerald">{followUpCounts.done} erledigt</UiBadge>
                <UiBadge tone="amber">{followUpCounts.blocked} blockiert</UiBadge>
              </div>
              {links.length > 0 && (
                <div className="mt-3 grid gap-1">
                  {linkedTasks.map(({ link, task }) => {
                    const status = normalizeStatus(task.status);
                    const isBlocked = status === "Blockiert" || hasOpenWaitingRelation(task.id, data.tasks, data.taskRelations as TaskRelation[]);
                    return (
                      <div key={link.id} className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1">
                        <button type="button" onClick={() => onOpenTask(task)} className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-slate-700 hover:text-blue-700">{task.title}</button>
                        <UiBadge tone={status === "Erledigt" ? "emerald" : isBlocked ? "amber" : "blue"} size="xs" bordered={false} className="shrink-0">
                          {status === "Erledigt" ? "erledigt" : isBlocked ? "blockiert" : "offen"}
                        </UiBadge>
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
                <UiTextInput
                  value={decisionNoteDrafts[decision.id] || ""}
                  onChange={(event) => onDecisionNoteDraftsChange((current) => ({ ...current, [decision.id]: event.target.value }))}
                  className="px-3"
                  placeholder="Warum folgt diese Aufgabe aus der Decision?"
                />
                <UiButton
                  disabled={pending || !selectedTaskId}
                  onClick={() => onLinkDecisionTask(decision.id, selectedTaskId, decisionNoteDrafts[decision.id] || "")}
                  variant="slate"
                >
                  Verknüpfen
                </UiButton>
              </div>
            </article>
          );
        })}
      </div>
    </UiPanel>
  );
}
