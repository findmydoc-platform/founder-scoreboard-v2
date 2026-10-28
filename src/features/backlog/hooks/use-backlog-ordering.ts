"use client";
import type { PlanningState } from "@/features/planning/model/planning-state";
import { backlogMoveTarget, type BacklogMoveAction, type BacklogMoveResult, type BacklogPlacement } from "../model/backlog-ordering";
import type { Task } from "@/lib/types";
export function useBacklogOrdering({ planningState, canManageBacklog, orderedTasks, setMessage }: { planningState: PlanningState; canManageBacklog: boolean; orderedTasks: Task[]; setMessage(message: string): void }) {
  const reorderTask = (taskId: string, targetTaskId: string, placement: BacklogPlacement, shown: readonly Task[] = orderedTasks): BacklogMoveResult => {
    if (!canManageBacklog) { setMessage("Nur CEO oder Deputy können die Backlog-Reihenfolge ändern."); return "blocked"; }
    if (taskId === targetTaskId || !shown.some(task => task.id === taskId) || !shown.some(task => task.id === targetTaskId)) return "ignored";
    setMessage(""); void planningState.beginBacklogOrder(shown).move(taskId,targetTaskId,placement).then(result => { setMessage(result.phase === "saved" ? `${result.affectedCount} Positionen gespeichert.` : result.error || "Die Rangfolge ist noch nicht bestätigt."); }); return "queued";
  };
  return { isReordering: planningState.backlogOrders().some(view => view.phase === "saving"), reorderTask,
    moveTask(taskId: string, action: BacklogMoveAction, shown: readonly Task[] = orderedTasks): BacklogMoveResult { const target = backlogMoveTarget(shown,taskId,action); return target ? reorderTask(taskId,target.targetTaskId,target.placement,shown) : "ignored"; },
  };
}
