import type { Task, TaskComment } from "@/lib/types";
import type { PlanningReadStatus, PlanningTaskSaveCheck } from "@/features/planning/model/planning-state";
export type TaskCommentNotice = { code: string; level: "info"; message: string };
export type TaskCommentSubmission = Readonly<{ id: string; submittedAt: string }>;
export type TaskCommentCreationView = Readonly<{ id: string; taskId: string; submitted: string; submittedAt: string; phase: "saving" | "confirmed" | "rejected" | "unconfirmed"; comment: TaskComment | null; notice: TaskCommentNotice | null; error: string; checkStatus: "not-checked" | "checking" | "checked" | "unavailable" }>;
export type TaskCommentCreationResult = { ok: true; comment: TaskComment; notice: TaskCommentNotice | null } | { ok: false; kind: "rejected" | "unconfirmed" | "blocked" | "ended"; error: string; status?: number };
export type TaskCommentCapture = Readonly<{ accepted: true; completion: Promise<TaskCommentCreationResult> } | { accepted: false; error: string; completion: Promise<TaskCommentCreationResult> }>;
export type TaskCommentCreationAdapter = {
 commentSubmissionStorage?: Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;
 createTaskComment?: (taskId: string, submitted: string, submission: TaskCommentSubmission) => Promise<{ comment: TaskComment; notice?: TaskCommentNotice | null }>;
 checkTaskCommentCreation?: (taskId: string, submission: TaskCommentSubmission) => Promise<{ outcome: "confirmed"; comment: TaskComment } | { outcome: "unconfirmed" }>;
};
export interface PlanningTaskComments {
 createTaskComment(task: Task, text: string): TaskCommentCapture;
 retryTaskCommentCreation(id: string): TaskCommentCapture;
 taskComments(taskId: string): { comments: readonly TaskComment[]; completeness: "complete" | "partial"; readStatus: PlanningReadStatus };
 taskCommentCreations(taskId?: string): readonly TaskCommentCreationView[];
 checkTaskCommentCreation(id: string): Promise<PlanningTaskSaveCheck>;
}
