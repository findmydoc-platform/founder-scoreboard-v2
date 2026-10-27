import type { Task } from "@/lib/types";
import type { AppWorkspace } from "./workspace-routes";
import type { TaskUpdateResult } from "@/features/tasks/hooks/task-mutation-command-types";

export type PlanningTaskEditorView = {
  phase: "editing" | "saving" | "saved" | "conflict" | "rejected" | "unconfirmed" | "ended";
  submitted: Readonly<Partial<Task>> | null;
  serverTask: Task | null;
  error: string;
  canResave: boolean;
};
export interface PlanningTaskEditor {
  view(): PlanningTaskEditorView;
  save(patch: Partial<Task>): Promise<TaskUpdateResult>;
  refreshConflict(): Promise<boolean>;
  resave(patch: Partial<Task>): Promise<TaskUpdateResult>;
  close(): void;
}

export type PlanningTaskSaveStatus = "saved" | "saving" | "rejected" | "unconfirmed";
export type PlanningBoardView = { tasks: readonly Task[]; freshness: "current" | "stale" };
export type PlanningTaskDetailView = { task: Task | null; saveStatus: PlanningTaskSaveStatus };

export interface PlanningState {
  board(): PlanningBoardView;
  taskDetail(taskId: string): PlanningTaskDetailView;
  protectedCache(): { tasks: readonly Task[] } | null;
  subscribe(listener: () => void): () => void;
  taskEdits(taskId: string): readonly PlanningTaskEditorView[];
  beginTaskEdit(taskId: string): PlanningTaskEditor;
  saveTask(task: Task, patch: Partial<Task>): Promise<TaskUpdateResult>;
  loadTaskDetail(taskId: string): Promise<{ ok: boolean; unavailable?: import("@/features/tasks/model/task-detail-read-model").TaskDetailUnavailableArea[] }>;
  refreshWorkspace(workspace: AppWorkspace): Promise<boolean>;
}
