import type { Task, TaskComment, TaskExternalComment, TaskBlocker, TaskRelation, TaskActivity, TaskReview } from "@/lib/types";
import type { AppWorkspace } from "./workspace-routes";
import type { TaskUpdateResult } from "@/features/tasks/hooks/task-mutation-command-types";

export type PlanningTaskEditorView = {
  phase: "editing" | "saving" | "saved" | "conflict" | "rejected" | "unconfirmed" | "blocked" | "ended";
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
  checkOutcome(): Promise<PlanningTaskSaveCheck>;
  close(): void;
}

export type PlanningTaskSaveView = {
  phase: "saving" | "queued" | "unconfirmed" | "blocked";
  submitted: Readonly<Partial<Task>> | null;
  checkStatus: "not-checked" | "checking" | "checked" | "unavailable" | "forbidden";
  serverTask: Task | null;
};
export type PlanningTaskSaveCheck = {
  outcome: "unconfirmed" | "not-pending" | "session-ended";
  readStatus: PlanningReadStatus | "not-needed";
};
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
  taskSaves(taskId: string): readonly PlanningTaskSaveView[];
  checkTaskSave(taskId: string): Promise<PlanningTaskSaveCheck>;
  taskEdits(taskId: string): readonly PlanningTaskEditorView[];
  beginTaskEdit(task: Task | string): PlanningTaskEditor;
  saveTask(task: Task, patch: Partial<Task>): Promise<TaskUpdateResult>;
  loadTaskDetail(taskId: string): Promise<{ ok: boolean; error?: string; unavailable?: import("@/features/tasks/model/task-detail-read-model").TaskDetailUnavailableArea[] }>;
  refreshWorkspace(workspace: AppWorkspace): Promise<boolean>;
}
