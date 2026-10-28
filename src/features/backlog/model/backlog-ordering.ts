import type { Task } from "@/lib/types";
export type BacklogPlacement = "before" | "after";
export type BacklogMoveAction = "up" | "down" | "top" | "bottom";
export type BacklogMoveResult = "queued" | "ignored" | "blocked";
export type BacklogOrderPatch = { id: string; sortOrder: number; updatedAt: string };
export type BacklogOrderResult = { phase: "saved" | "rejected" | "conflict" | "unconfirmed" | "blocked" | "ended"; affectedCount: number; error?: string };
export type BacklogOrderView = { id: string; phase: "editing" | "saving" | BacklogOrderResult["phase"]; source: Task | null; target: Task | null; placement: BacklogPlacement; error: string; checking: boolean; canResave: boolean; serverTasks: readonly Task[]; confirmedIds: readonly string[] };
export interface BacklogOrderEditor { view(): BacklogOrderView; move(taskId: string, targetTaskId: string, placement: BacklogPlacement): Promise<BacklogOrderResult>; checkOutcome(): Promise<boolean>; refreshConflict(): Promise<boolean>; resave(): Promise<BacklogOrderResult>; }
export type BacklogOrderingAdapter = { moveBacklog?: (source: Task, target: Task, placement: BacklogPlacement) => Promise<{ updates: BacklogOrderPatch[]; completeness: "complete" | "partial" }> };
export function backlogMoveTarget(tasks: readonly Task[], taskId: string, action: BacklogMoveAction) {
  const index = tasks.findIndex(task => task.id === taskId); if (index < 0) return null;
  const target = action === "up" ? tasks[index - 1] : action === "down" ? tasks[index + 1] : action === "top" ? tasks[0] : tasks.at(-1);
  return target && target.id !== taskId ? { targetTaskId: target.id, placement: action === "up" || action === "top" ? "before" as const : "after" as const } : null;
}
