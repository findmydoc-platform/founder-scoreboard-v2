import type { Task, TaskComment } from "@/lib/types";
import type { PlanningReadStatus, PlanningTaskSaveCheck } from "@/features/planning/model/planning-state";
export type TaskCommentNotice = { code: string; level: "info"; message: string };
export type TaskCommentCreationView = Readonly<{ id: string; taskId: string; submitted: string; phase: "saving" | "confirmed" | "rejected" | "unconfirmed"; comment: TaskComment | null; notice: TaskCommentNotice | null; error: string; checkStatus: "not-checked" | "checking" | "checked" | "unavailable" }>;
export type TaskCommentCreationResult = { ok: true; comment: TaskComment; notice: TaskCommentNotice | null } | { ok: false; kind: "rejected" | "unconfirmed" | "blocked" | "ended"; error: string; status?: number };
export type TaskCommentCreationAdapter = { createTaskComment?: (taskId: string, submitted: string) => Promise<{ comment: TaskComment; notice?: TaskCommentNotice | null }> };
export interface PlanningTaskComments {
 createTaskComment(task: Task, text: string): Promise<TaskCommentCreationResult>;
 taskComments(taskId: string): { comments: readonly TaskComment[]; completeness: "complete" | "partial"; readStatus: PlanningReadStatus };
 taskCommentCreations(taskId?: string): readonly TaskCommentCreationView[];
 checkTaskCommentCreation(id: string): Promise<PlanningTaskSaveCheck>;
}
