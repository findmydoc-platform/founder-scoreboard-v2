import type { Task, TaskComment, TaskExternalComment, TaskBlocker, TaskRelation, TaskActivity, TaskReview } from "@/lib/types";
import type { AppWorkspace } from "./workspace-routes";
import type { TaskUpdateResult } from "@/features/tasks/hooks/task-mutation-command-types";

export type PlanningTaskSaveStatus = "saved" | "saving" | "rejected" | "unconfirmed";
export type PlanningBoardView = { tasks: readonly Task[]; freshness: "current" | "stale" };
export type PlanningReadStatus = "not-loaded" | "loading" | "current" | "stale" | "unavailable" | "forbidden";
export type PlanningTaskDetailView = {
  task: Task | null;
  saveStatus: PlanningTaskSaveStatus;
  readStatus: PlanningReadStatus;
  unavailable: readonly import("@/features/tasks/model/task-detail-read-model").TaskDetailUnavailableArea[];
  comments: readonly TaskComment[];
  externalComments: readonly TaskExternalComment[];
  blockers: readonly TaskBlocker[];
  relationships: readonly TaskRelation[];
  activities: readonly TaskActivity[];
  reviews: readonly TaskReview[];
};

export type PlanningWorkspaceView = {
  tasks: readonly Task[];
  readStatus: PlanningReadStatus;
  completeness: "complete" | "partial" | "none";
};
export interface PlanningState {
  board(): PlanningBoardView;
  workspace(workspace: AppWorkspace): PlanningWorkspaceView;
  taskDetail(taskId: string): PlanningTaskDetailView;
  protectedCache(workspace?: AppWorkspace): { tasks: readonly Task[] } | null;
  subscribe(listener: () => void): () => void;
  saveTask(task: Task, patch: Partial<Task>): Promise<TaskUpdateResult>;
  loadTaskDetail(taskId: string): Promise<{ ok: boolean; error?: string; unavailable?: import("@/features/tasks/model/task-detail-read-model").TaskDetailUnavailableArea[] }>;
  refreshWorkspace(workspace: AppWorkspace): Promise<boolean>;
}
