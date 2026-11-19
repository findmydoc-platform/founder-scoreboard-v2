"use client";
import { useEffect, useRef, useState } from "react";
import type { PlanningState } from "@/features/planning/model/planning-state";
import { backlogMoveTarget, type BacklogMoveAction, type BacklogMoveResult, type BacklogPlacement } from "../model/backlog-ordering";
import type { Task } from "@/lib/types";
export function useBacklogOrdering({ planningState, canManageBacklog, scoped = false, orderedTasks, setMessage }: { planningState: PlanningState; canManageBacklog: boolean; scoped?: boolean; orderedTasks: Task[]; setMessage(message: string): void }) {
  const [resolving, setResolving] = useState(false), pending = useRef<AbortController | null>(null), mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; pending.current?.abort(); }; }, []);
  const report = (result: import("../model/backlog-ordering").BacklogOrderResult | null) => { if (mounted.current && result) setMessage(result.phase === "saved" ? `${result.affectedCount} Positionen gespeichert.` : result.error || "Die Rangfolge ist noch nicht bestätigt."); };
  const reorderTask = (taskId: string, targetTaskId: string, placement: BacklogPlacement, shown: readonly Task[] = orderedTasks): BacklogMoveResult => {
    if (!canManageBacklog) { setMessage("Nur CEO oder Deputy können die Backlog-Reihenfolge ändern."); return "blocked"; }
    if (taskId === targetTaskId || !shown.some(task => task.id === taskId) || !shown.some(task => task.id === targetTaskId)) return "ignored";
    setMessage(""); void planningState.beginBacklogOrder(shown, { complete: !scoped }).move(taskId,targetTaskId,placement).then(result => { report(result); if (scoped && ["saved", "unconfirmed"].includes(result.phase)) void planningState.refreshWorkspace("backlog"); }); return "queued";
  };
  return { isReordering: resolving || planningState.backlogOrders().some(view => view.phase === "saving"), reorderTask,
    moveTask(taskId: string, action: BacklogMoveAction, shown: readonly Task[] = orderedTasks): BacklogMoveResult {
      if (scoped) {
        if (!canManageBacklog) { setMessage("Nur CEO oder Deputy können die Backlog-Reihenfolge ändern."); return "blocked"; }
        const source = shown.find(task => task.id === taskId); if (!source) return "ignored";
        pending.current?.abort(); const controller = new AbortController(); pending.current = controller; setResolving(true); setMessage("");
        void planningState.moveBacklogRelative(source, action, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) report(result); })
          .finally(() => { if (mounted.current && pending.current === controller) setResolving(false); });
        return "queued";
      }
      const target = backlogMoveTarget(shown,taskId,action); return target ? reorderTask(taskId,target.targetTaskId,target.placement,shown) : "ignored"; },
  };
}
