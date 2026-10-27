import type { Task } from "@/lib/types";
import type { AppWorkspace } from "./workspace-routes";
import type { TaskUpdateResult } from "@/features/tasks/hooks/task-mutation-command-types";

export type PlanningTaskSaveStatus = "saved" | "saving" | "rejected" | "unconfirmed";
export type PlanningBoardView = { tasks: readonly Task[]; freshness: "current" | "stale" };
export type PlanningTaskDetailView = { task: Task | null; saveStatus: PlanningTaskSaveStatus };

export interface PlanningState {
  board(): PlanningBoardView;
  taskDetail(taskId: string): PlanningTaskDetailView;
  protectedCache(): { tasks: readonly Task[] } | null;
  subscribe(listener: () => void): () => void;
  saveTask(task: Task, patch: Partial<Task>): Promise<TaskUpdateResult>;
  loadTaskDetail(taskId: string): Promise<{ ok: boolean; unavailable?: import("@/features/tasks/model/task-detail-read-model").TaskDetailUnavailableArea[] }>;
  refreshWorkspace(workspace: AppWorkspace): Promise<boolean>;
}
